import { createAdminClient } from "@/lib/supabase/server";
import { computeOperatorImageCount } from "@/lib/venueReadiness";
import { computeVenueSetupStatus } from "@/lib/venueSetupStatus";
import type { OnboardingCompletionMode } from "@/lib/homepagePhase";
import { getVenuePlanCode } from "@/lib/venueSubscriptions";
import type { OperatorPlan } from "@/lib/plans";

/**
 * Data helper for the Control Panel Venue Detail "Health Panel" (right column
 * of /control-panel/venues/[id]). Mirrors the lifecycle/setup logic already
 * used by the Founder Dashboard (src/lib/data/founderDashboard.ts) and the
 * shared computeVenueSetupStatus() helper, so a single venue's panel always
 * agrees with the platform-wide counts.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SetupChecklistItem = { label: string; completed: boolean };

export type HealthStatus = "healthy" | "needs_attention" | "at_risk";

export type LifecycleStage = "onboarding_complete" | "still_onboarding" | "not_active";

export type OperatorActivityStatus =
  | "active"            // last_seen_at within 30 days
  | "inactive"           // last_seen_at 31-90 days ago
  | "dormant"            // last_seen_at 90+ days ago
  | "never_logged_in"    // operator exists, last_seen_at IS NULL
  | "not_active";        // no operator attached to this venue at all

export type PaidStatus = "free" | "paid" | "not_active";

export type VenueHealthInput = {
  venueId: string;
  operatorId: string | null;
  isPublished: boolean;
  isVerified: boolean;
  source: string | null;
  hhTimes: string | null;
  businessHours: Record<string, unknown> | null;
  hhFoodDetails: string | null;
  hhDrinkDetails: string | null;
  // Already fetched on the page via the venues→operators FK embed — passed in
  // here rather than re-queried, to keep this helper's own queries minimal.
  operatorName: string | null;
  operatorEmail: string | null;
  operatorLastSeenAt: string | null;
  venueUpdatedAt: string | null;
  // Phase 1B — Founder/Admin manual onboarding-completion override (already
  // fetched on the page via the venues row) — passed in rather than re-queried.
  onboardingOverrideAt: string | null;
  onboardingOverrideByEmail: string | null;
  onboardingOverrideReason: string | null;
};

export type VenueHealthData = {
  // 1. Setup Health Score (setup/onboarding only — see comment at calculation site)
  setupHealthScorePct: number;
  setupCompletedCount: number;
  setupTotalCount: number;
  setupStatus: HealthStatus;

  // 2. Lifecycle
  source: string | null;
  isVerified: boolean;
  isActive: boolean;
  isPublished: boolean;
  lifecycleStage: LifecycleStage;
  // Phase 1B — distinguishes *why* onboarding is (or isn't) complete.
  // "manual" takes precedence in display even if automatic also happens to
  // be satisfied — see computeEffectiveOnboarding() in homepagePhase.ts.
  onboardingCompletionMode: OnboardingCompletionMode;
  onboardingOverrideAt: string | null;
  onboardingOverrideByEmail: string | null;
  onboardingOverrideReason: string | null;
  plan: OperatorPlan | null; // null when venue has no attached operator

  // 3. Setup status checklist (same data backing the score above)
  setupChecklist: SetupChecklistItem[];

  // 4. Operator activity (kept separate from the health score — see below)
  operatorName: string | null;
  operatorEmail: string | null;
  operatorLastSeenAt: string | null;
  operatorActivityStatus: OperatorActivityStatus;
  teamMembersCount: number | null; // null = not available

  // 5. Consumer demand
  venueViews30d: number;
  venueViews7d: number;
  eventViews30d: number;
  topEventLabel: string | null;
  topEventViews: number | null;

  // 6. Monetization (revenue fields are intentionally placeholders — see TODO)
  paidStatus: PaidStatus;
  upgradeOpportunity: boolean | null; // null = not evaluated (no operator/plan)

  // 7. Venue freshness
  // venueUpdatedAt may eventually support stale-listing reports, Action Center
  // work-queue entries, operator nudges, and venue health scoring improvements.
  venueUpdatedAt: string | null;
};

// ── Setup checklist definition ─────────────────────────────────────────────
// matchLabel must exactly match the strings emitted by
// computeVenueSetupStatus()'s missingItems[] (src/lib/venueSetupStatus.ts) —
// that array is the single source of truth for "what's missing"; this list
// just maps each possible entry to a founder-friendly display label and lets
// us show BOTH completed and missing items (missingItems[] only lists the
// latter).
const SETUP_ITEMS: { matchLabel: string; displayLabel: string }[] = [
  { matchLabel: "Not published",    displayLabel: "Published" },
  { matchLabel: "Happy hour times", displayLabel: "Happy Hour Times" },
  { matchLabel: "Business hours",   displayLabel: "Business Hours" },
  { matchLabel: "Photo",            displayLabel: "Photo" },
  { matchLabel: "Food specials",    displayLabel: "Food Specials" },
  { matchLabel: "Drink specials",   displayLabel: "Drink Specials" },
];

function setupStatusForPct(pct: number): HealthStatus {
  if (pct >= 90) return "healthy";
  if (pct >= 60) return "needs_attention";
  return "at_risk";
}

// ── Main data fetch ────────────────────────────────────────────────────────

export async function getVenueHealthData(input: VenueHealthInput): Promise<VenueHealthData> {
  const supabase = createAdminClient();
  const now = Date.now();
  const t7  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
  const t30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const isActive = input.operatorId != null;

  const [r_media, r_venueViews30d, r_venueViews7d, r_events, r_membershipCount, plan] = await Promise.all([
    supabase.from("media").select("url").eq("venue_id", input.venueId).eq("type", "venue_image"),
    supabase.from("venue_view_events").select("*", { count: "exact", head: true })
      .eq("venue_id", input.venueId).gte("viewed_at", t30),
    supabase.from("venue_view_events").select("*", { count: "exact", head: true })
      .eq("venue_id", input.venueId).gte("viewed_at", t7),
    supabase.from("events").select("id, title").eq("venue_id", input.venueId),
    isActive
      ? supabase.from("operator_memberships").select("*", { count: "exact", head: true })
          .eq("operator_id", input.operatorId as string).eq("status", "active")
      : Promise.resolve({ count: null as number | null }),
    // Phase 2B: this VENUE's own plan (venue_subscriptions; no row → 'free'),
    // never the operator's — a multi-venue operator's venues can now hold
    // different plans, and this page is about one specific venue.
    isActive ? getVenuePlanCode(input.venueId) : Promise.resolve(null),
  ]);

  // ── Consumer demand: event views require a second query keyed off this
  //    venue's event ids (event_view_events has no venue_id column). ───────
  const eventRows = (r_events.data ?? []) as { id: string; title: string | null }[];
  const eventIds = eventRows.map((e) => e.id);

  let eventViews30d = 0;
  let topEventLabel: string | null = null;
  let topEventViews: number | null = null;

  if (eventIds.length > 0) {
    const { data: viewRows } = await supabase
      .from("event_view_events")
      .select("event_id")
      .in("event_id", eventIds)
      .gte("viewed_at", t30);

    const counts = new Map<string, number>();
    for (const { event_id } of (viewRows ?? []) as { event_id: string }[]) {
      counts.set(event_id, (counts.get(event_id) ?? 0) + 1);
    }
    eventViews30d = [...counts.values()].reduce((a, b) => a + b, 0);

    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const [topId, views] = top;
      topEventLabel = eventRows.find((e) => e.id === topId)?.title ?? "Unknown";
      topEventViews = views;
    }
  }

  // ── Setup status — same shared helper as the Founder Dashboard ────────────
  const images = (r_media.data ?? []) as { url: string }[];
  const imageCount = images.length;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const operatorImageCount = computeOperatorImageCount(images, supabaseUrl);

  const { onboardingComplete, onboardingCompletionMode, missingItems } = computeVenueSetupStatus(
    {
      hh_times:         input.hhTimes,
      business_hours:   input.businessHours,
      hh_food_details:  input.hhFoodDetails,
      hh_drink_details: input.hhDrinkDetails,
      imageCount,
      operatorImageCount,
    },
    input.isPublished,
    !!input.onboardingOverrideAt,
  );

  const setupChecklist: SetupChecklistItem[] = SETUP_ITEMS.map(({ matchLabel, displayLabel }) => ({
    label: displayLabel,
    completed: !missingItems.includes(matchLabel),
  }));
  const setupCompletedCount = setupChecklist.filter((i) => i.completed).length;
  const setupTotalCount = setupChecklist.length;

  // ── Setup Health Score (V1) ────────────────────────────────────────────────
  // IMPORTANT — this is a SETUP/ONBOARDING health score ONLY:
  //   Score = completed required setup items / total required setup items.
  // It intentionally EXCLUDES operator activity, consumer demand,
  // monetization, and revenue — those are shown as their own sections below
  // and must never be folded into this number. Future versions may introduce
  // separate engagement/demand/revenue health indicators, but they should be
  // additive (new scores/badges), not a silent redefinition of this one.
  const setupHealthScorePct = Math.round((setupCompletedCount / setupTotalCount) * 100);
  const setupStatus = setupStatusForPct(setupHealthScorePct);

  const lifecycleStage: LifecycleStage = !isActive
    ? "not_active"
    : onboardingComplete
      ? "onboarding_complete"
      : "still_onboarding";

  // ── Operator activity — kept fully separate from the health score above ──
  const lastSeenMs = input.operatorLastSeenAt ? new Date(input.operatorLastSeenAt).getTime() : null;
  let operatorActivityStatus: OperatorActivityStatus;
  if (!isActive) {
    operatorActivityStatus = "not_active";
  } else if (lastSeenMs == null) {
    operatorActivityStatus = "never_logged_in";
  } else if (lastSeenMs >= now - 30 * 24 * 60 * 60 * 1000) {
    operatorActivityStatus = "active";
  } else if (lastSeenMs >= now - 90 * 24 * 60 * 60 * 1000) {
    operatorActivityStatus = "inactive";
  } else {
    operatorActivityStatus = "dormant";
  }

  // ── Monetization ────────────────────────────────────────────────────────
  const paidStatus: PaidStatus = !isActive
    ? "not_active"
    : plan === "pro" || plan === "premium" || plan === "enterprise"
      ? "paid"
      : "free";

  // Mirrors the Founder Dashboard's upgradeOpportunities definition (Free or
  // Pro venues may have an upgrade opportunity; Premium/Enterprise never do).
  const upgradeOpportunity: boolean | null =
    !isActive || plan == null ? null : plan === "free" || plan === "pro";

  return {
    setupHealthScorePct,
    setupCompletedCount,
    setupTotalCount,
    setupStatus,

    source: input.source,
    isVerified: input.isVerified,
    isActive,
    isPublished: input.isPublished,
    lifecycleStage,
    onboardingCompletionMode,
    onboardingOverrideAt: input.onboardingOverrideAt,
    onboardingOverrideByEmail: input.onboardingOverrideByEmail,
    onboardingOverrideReason: input.onboardingOverrideReason,
    plan: plan as OperatorPlan | null,

    setupChecklist,

    operatorName: input.operatorName,
    operatorEmail: input.operatorEmail,
    operatorLastSeenAt: input.operatorLastSeenAt,
    operatorActivityStatus,
    teamMembersCount: r_membershipCount.count ?? null,

    venueViews30d: r_venueViews30d.count ?? 0,
    venueViews7d: r_venueViews7d.count ?? 0,
    eventViews30d,
    topEventLabel,
    topEventViews,

    paidStatus,
    upgradeOpportunity,

    venueUpdatedAt: input.venueUpdatedAt,
  };
}
