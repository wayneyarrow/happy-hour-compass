import { createAdminClient } from "@/lib/supabase/server";
import { computeOperatorImageCount } from "@/lib/venueReadiness";
import { computeVenueSetupStatus } from "@/lib/venueSetupStatus";
import { parseOperatorPlan, type OperatorPlan } from "@/lib/plans";
import { getVenueViewCounts, getEventViewCounts, sumViews } from "@/lib/data/viewCounts";

// ── Plan rank for upgrade/downgrade classification ─────────────────────────────

const PLAN_RANK: Record<string, number> = {
  free: 0, pro: 1, premium: 2, enterprise: 3,
};

function isUpgrade(from: string, to: string): boolean {
  return (PLAN_RANK[to] ?? 0) > (PLAN_RANK[from] ?? 0);
}

function isDowngrade(from: string, to: string): boolean {
  return (PLAN_RANK[to] ?? 0) < (PLAN_RANK[from] ?? 0);
}

function n(count: number | null | undefined): number {
  return count ?? 0;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type TopItem = { id: string; label: string; views: number };
export type SetupItemCount = { label: string; count: number };

/** A numerator/denominator pair. The page computes % and divide-by-zero safety. */
export type ConversionRate = { numerator: number; denominator: number };

export type FounderDashboardData = {
  fetchedAt: string;

  // "Are we acquiring venue opportunities?"
  acquisition: {
    suggestedVenues:          number;
    newSuggestedVenues30d:    number;
    submittedVenues:          number;
    newSubmittedVenues30d:    number;
    seededVenues:             number;
    newSeededVenues30d:       number;
    claimedVenues:            number;
    newClaimedVenues30d:      number;
    seedToClaim:              ConversionRate;
  };

  // "Are verified venues becoming active and completing setup, and are
  //  operators actually coming back?"
  activation: {
    verifiedVenues:           number;
    activeVenues:             number;
    stillOnboarding:          number;
    onboardingComplete:       number;
    topMissingSetupItems:     SetupItemCount[];
    verifiedToActive:         ConversionRate;
    activeToVenueHq:          ConversionRate;
    // Operator usage/engagement — last_seen_at based, mutually exclusive buckets.
    activeOperators:          number;
    inactiveOperators:        number;
    neverLoggedInOperators:   number;
  };

  // "Are active venues converting to paid plans?"
  monetization: {
    totalVenues:              number;
    claimedVenues:            number;
    seededVenues:              number;
    submittedVenues:           number;
    freeVenues:                number;
    proVenues:                 number;
    premiumVenues:             number;
    paidVenues:                number;
    // Operator-level churn proxy applied to a venue-based formula — see TODO
    // at the query site. There is no venue-level churn signal yet (no venue
    // deactivation/closure event in the schema).
    churnedVenuesAllTime:      number;
    // Denominator = (Seeded + Submitted) - Churned. Suggested Venues are
    // intentionally excluded — a suggestion is a lead signal, not inventory,
    // until it becomes seeded or submitted.
    monetizationRate:          ConversionRate;
    claimToPaid:               ConversionRate;
    freeToPro:                 ConversionRate;
    proToPremium:              ConversionRate;
    upgradesLast30d:           number;
    downgradesLast30d:         number;
    churnLast30d:              number;
    // TODO: Future monetization dashboard should include MRR, total revenue,
    // revenue per active venue, and revenue per paid venue (Stripe-backed —
    // not in scope for this pass).
  };

  // "Are consumers engaging?"
  consumerDemand: {
    venueViewsLast30d: number;
    eventViewsLast30d: number;
    topVenues:         TopItem[];
    topEvents:         TopItem[];
  };

  // "What needs attention?"
  operationalSignals: {
    activeVenuesStillOnboarding: number;
    missingSetupItemInstances:    number;
    upgradeOpportunities:         number;
    // Inactive (last_seen_at < 30d ago, not null) — excludes Never Logged In,
    // which is tracked separately in Activation.
    inactiveOperators:            number;
    highDemandVenues:             number;
    highDemandEvents:             number;
  };
};

// ── High-demand thresholds (early-stage beta baselines) ───────────────────────
// TODO: revisit once venue_view_events data has been flowing for 60+ days.
const HIGH_DEMAND_VENUE = 10; // views in 30d
const HIGH_DEMAND_EVENT = 5;  // views in 30d

// ── Internal types ─────────────────────────────────────────────────────────────

type ActiveVenueRow = {
  id: string;
  created_by_operator_id: string | null;
  is_published: boolean | null;
  hh_times: string | null;
  business_hours: Record<string, unknown> | null;
  hh_food_details: string | null;
  hh_drink_details: string | null;
  /** Phase 1B — Founder/Admin manual onboarding-completion override. Not null = override active. */
  onboarding_completed_override_at: string | null;
};

type MediaRow = { venue_id: string; url: string };
type PlanChangeRow = { from_plan: string; to_plan: string; operator_id: string };
type VenueSubscriptionPlanRow = { venue_id: string; plan_code: string | null };

function safeDivide(numerator: number, denominator: number): ConversionRate {
  return { numerator, denominator };
}

// ── Main data fetch ────────────────────────────────────────────────────────────

export async function getFounderDashboardData(): Promise<FounderDashboardData> {
  const supabase = createAdminClient();
  const now = Date.now();
  const t30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // ── Batch 1: all independent queries run in parallel ──────────────────────
  const [
    r_suggestedVenues,
    r_newSuggestedVenues30d,
    r_submittedVenues,
    r_newSubmittedVenues30d,
    r_totalVenues,
    r_seededVenues,
    r_newSeededVenues30d,
    r_claimedVenues,
    r_newClaimedVenues30d,
    r_unclaimedSeededVenues,
    r_verifiedVenues,
    r_activeVenueRows,
    r_activeOperators,
    r_inactiveOperators,
    r_neverLoggedInOperators,
    r_planChanges30d,
    r_cancelledVenues,
    venueViewCounts,
    eventViewCounts,
  ] = await Promise.all([
    // venue_suggestions / operator_submissions — Acquisition
    supabase.from("venue_suggestions").select("*", { count: "exact", head: true }),
    supabase.from("venue_suggestions").select("*", { count: "exact", head: true }).gte("submitted_at", t30),
    supabase.from("operator_submissions").select("*", { count: "exact", head: true }),
    supabase.from("operator_submissions").select("*", { count: "exact", head: true }).gte("submitted_at", t30),

    // venues — Acquisition + Activation
    supabase.from("venues").select("*", { count: "exact", head: true }),
    supabase.from("venues").select("*", { count: "exact", head: true }).eq("source", "seed"),
    supabase.from("venues").select("*", { count: "exact", head: true }).eq("source", "seed").gte("created_at", t30),
    supabase.from("venues").select("*", { count: "exact", head: true }).not("claimed_at", "is", null),
    supabase.from("venues").select("*", { count: "exact", head: true }).gte("claimed_at", t30),
    // Seeded venues with no claim yet — used to derive "seeded AND claimed" for Seed → Claim.
    supabase.from("venues")
      .select("*", { count: "exact", head: true })
      .eq("source", "seed")
      .is("claimed_at", null),
    supabase.from("venues").select("*", { count: "exact", head: true }).eq("is_verified", true),

    // Active venues (created_by_operator_id IS NOT NULL). Also the source for
    // onboarding-completion checks and the operator-plan lookup below — an
    // active venue and its attached operator are 1:1 (one-venue-per-operator).
    supabase.from("venues")
      .select("id, created_by_operator_id, is_published, hh_times, business_hours, hh_food_details, hh_drink_details, onboarding_completed_override_at")
      .not("created_by_operator_id", "is", null),

    // operators — Activation usage/engagement + Operational Signals
    // (engagement, not monetization). Three mutually exclusive buckets.
    supabase.from("operators")
      .select("*", { count: "exact", head: true })
      .gte("last_seen_at", t30),
    supabase.from("operators")
      .select("*", { count: "exact", head: true })
      .not("last_seen_at", "is", null)
      .lt("last_seen_at", t30),
    supabase.from("operators")
      .select("*", { count: "exact", head: true })
      .is("last_seen_at", null),

    // plan_change_events — Monetization
    supabase.from("plan_change_events")
      .select("from_plan, to_plan, operator_id")
      .gte("changed_at", t30),
    // True venue-level churn: venues where an operator cancelled management.
    // Fetch cancelled_at so we can compute both all-time and 30-day counts in JS
    // without adding a second query (keeps Promise.all under TS's tuple limit).
    supabase.from("venues")
      .select("cancelled_at")
      .not("cancelled_at", "is", null),

    // Per-venue / per-event view counts via GROUP BY RPC (migration 088 —
    // see src/lib/data/viewCounts.ts). Replaces a raw-row fetch + JS
    // aggregation that was subject to PostgREST's default row-return cap
    // once platform-wide 30-day view volume grew past it.
    getVenueViewCounts(t30),
    getEventViewCounts(t30),
  ]);

  // ── Active venues ──────────────────────────────────────────────────────────
  const activeVenues = (r_activeVenueRows.data ?? []) as ActiveVenueRow[];

  // ── Process plan changes (operator-event based — unchanged) ──────────────
  const planChanges = (r_planChanges30d.data ?? []) as PlanChangeRow[];
  const upgradesLast30d   = planChanges.filter(e => isUpgrade(e.from_plan, e.to_plan)).length;
  const downgradesLast30d = planChanges.filter(e => isDowngrade(e.from_plan, e.to_plan)).length;
  // True venue-level churn from cancelled_at — replaces the plan-downgrade proxy.
  const cancelledVenueRows   = (r_cancelledVenues.data ?? []) as unknown as { cancelled_at: string }[];
  const churnedVenuesAllTime = cancelledVenueRows.length;
  const churnLast30d         = cancelledVenueRows.filter(v => v.cancelled_at >= t30).length;

  // ── Leaderboards (venueViewCounts/eventViewCounts are already per-id
  //    Maps — see the RPC-backed fetch above) ────────────────────────────────
  const topVenueEntries = [...venueViewCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topEventEntries = [...eventViewCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const activeVenueIds = activeVenues.map(v => v.id);

  // ── Batch 2: leaderboard names + venue media + venue plan lookup ─────────
  const [r_venueNames, r_eventNames, r_venueMedia, r_venuePlans] = await Promise.all([
    topVenueEntries.length > 0
      ? supabase.from("venues").select("id, name").in("id", topVenueEntries.map(([id]) => id))
      : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    topEventEntries.length > 0
      ? supabase.from("events").select("id, title").in("id", topEventEntries.map(([id]) => id))
      : Promise.resolve({ data: [] as { id: string; title: string | null }[] }),

    // Media for active venues (to detect operator-uploaded images).
    activeVenueIds.length > 0
      ? supabase.from("media")
          .select("venue_id, url")
          .in("venue_id", activeVenueIds)
          .eq("type", "venue_image")
      : Promise.resolve({ data: [] as MediaRow[] }),

    // Phase 2B: batched per-VENUE plan lookup (venue_subscriptions; no row
    // → 'free') — replaces the old per-operator lookup. Each venue's own
    // plan is used directly; a multi-venue operator's venues are no longer
    // assumed to share one plan.
    activeVenueIds.length > 0
      ? supabase.from("venue_subscriptions").select("venue_id, plan_code").in("venue_id", activeVenueIds)
      : Promise.resolve({ data: [] as VenueSubscriptionPlanRow[] }),
  ]);

  // ── Build leaderboards ────────────────────────────────────────────────────
  const venueNameMap = new Map(
    (r_venueNames.data ?? []).map(v => [v.id, (v.name as string | null) ?? "Unknown"])
  );
  const eventNameMap = new Map(
    ((r_eventNames.data ?? []) as { id: string; title: string | null }[]).map(e => [
      e.id,
      e.title ?? "Unknown",
    ])
  );

  const topVenues: TopItem[] = topVenueEntries.map(([id, views]) => ({
    id,
    label: venueNameMap.get(id) ?? "Unknown",
    views,
  }));
  const topEvents: TopItem[] = topEventEntries.map(([id, views]) => ({
    id,
    label: eventNameMap.get(id) ?? "Unknown",
    views,
  }));

  // >= matches Action Center's threshold semantics and the "10+"/"5+" UI
  // copy on both surfaces — previously ">" here (11+/6+) undercounted
  // relative to Action Center's High Demand reports for venues/events
  // sitting at exactly the threshold.
  const highDemandVenues = [...venueViewCounts.values()].filter(v => v >= HIGH_DEMAND_VENUE).length;
  const highDemandEvents = [...eventViewCounts.values()].filter(v => v >= HIGH_DEMAND_EVENT).length;

  // ── Resolve each venue's own plan (venue_subscriptions; no row → 'free') ──
  // Phase 2B: never falls back to operators.plan — see
  // src/lib/venueSubscriptions.ts for why that fallback is unsafe once
  // venues under one operator can diverge.
  const planByVenue = new Map(
    ((r_venuePlans.data ?? []) as VenueSubscriptionPlanRow[]).map(
      r => [r.venue_id, parseOperatorPlan(r.plan_code)] as const
    )
  );
  function planForVenue(venueId: string): OperatorPlan {
    return planByVenue.get(venueId) ?? "free";
  }

  // ── Classify active venues by their OWN plan ──────────────────────────────
  let freeVenues = 0;
  let proVenues = 0;
  let premiumVenues = 0;
  for (const venue of activeVenues) {
    if (!venue.created_by_operator_id) continue; // query already filters this out
    const plan = planForVenue(venue.id);
    if (plan === "free") freeVenues++;
    else if (plan === "pro") proVenues++;
    else if (plan === "premium") premiumVenues++;
    // 'enterprise' active venues, if any, are not bucketed in this V1 breakdown
    // (matches the pre-existing free/pro/premium-only breakdown — no enterprise
    // customers exist yet). TODO: add an enterprise bucket if one signs up.
  }
  const paidVenues = proVenues + premiumVenues;

  // Free and Pro venues may have an upgrade opportunity; Premium never does.
  const upgradeOpportunities = freeVenues + proVenues;

  // ── Compute onboarding status per active venue ─────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  // Group media URLs by venue_id for O(1) lookup below.
  const mediaByVenue = new Map<string, string[]>();
  for (const row of (r_venueMedia.data ?? []) as MediaRow[]) {
    const list = mediaByVenue.get(row.venue_id) ?? [];
    list.push(row.url);
    mediaByVenue.set(row.venue_id, list);
  }

  const missingItemCounts: Record<string, number> = {};
  let stillOnboarding = 0;

  for (const venue of activeVenues) {
    const images = (mediaByVenue.get(venue.id) ?? []).map(url => ({ url }));
    const imageCount = images.length;
    const operatorImageCount = computeOperatorImageCount(images, supabaseUrl);

    const { onboardingComplete, missingItems } = computeVenueSetupStatus(
      {
        hh_times:        venue.hh_times,
        business_hours:  venue.business_hours,
        hh_food_details: venue.hh_food_details,
        hh_drink_details: venue.hh_drink_details,
        imageCount,
        operatorImageCount,
      },
      !!venue.is_published,
      !!venue.onboarding_completed_override_at,
    );

    if (!onboardingComplete) {
      stillOnboarding++;
      for (const label of missingItems) {
        missingItemCounts[label] = (missingItemCounts[label] ?? 0) + 1;
      }
    }
  }

  const topMissingSetupItems: SetupItemCount[] = Object.entries(missingItemCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
  const missingSetupItemInstances = topMissingSetupItems.reduce((sum, item) => sum + item.count, 0);

  const activeVenuesCount = activeVenues.length;
  const onboardingComplete = activeVenuesCount - stillOnboarding;
  const seededVenues = n(r_seededVenues.count);
  const unclaimedSeededVenues = n(r_unclaimedSeededVenues.count);
  const seededAndClaimedVenues = seededVenues - unclaimedSeededVenues;
  const claimedVenues = n(r_claimedVenues.count);
  const verifiedVenues = n(r_verifiedVenues.count);
  const totalVenues = n(r_totalVenues.count);
  const submittedVenues = n(r_submittedVenues.count);

  // Monetization denominator: Seeded + Submitted - Churned. Suggested Venues
  // are intentionally excluded — see comment on the type definition above.
  const seededSubmittedNonChurned = seededVenues + submittedVenues - churnedVenuesAllTime;

  return {
    fetchedAt: new Date().toISOString(),

    acquisition: {
      suggestedVenues:       n(r_suggestedVenues.count),
      newSuggestedVenues30d: n(r_newSuggestedVenues30d.count),
      submittedVenues,
      newSubmittedVenues30d: n(r_newSubmittedVenues30d.count),
      seededVenues,
      newSeededVenues30d:    n(r_newSeededVenues30d.count),
      claimedVenues,
      newClaimedVenues30d:   n(r_newClaimedVenues30d.count),
      seedToClaim:           safeDivide(seededAndClaimedVenues, seededVenues),
    },

    activation: {
      verifiedVenues,
      activeVenues:        activeVenuesCount,
      stillOnboarding,
      onboardingComplete,
      topMissingSetupItems,
      verifiedToActive:    safeDivide(activeVenuesCount, verifiedVenues),
      activeToVenueHq:     safeDivide(onboardingComplete, activeVenuesCount),
      activeOperators:        n(r_activeOperators.count),
      inactiveOperators:      n(r_inactiveOperators.count),
      neverLoggedInOperators: n(r_neverLoggedInOperators.count),
    },

    monetization: {
      totalVenues,
      claimedVenues,
      seededVenues,
      submittedVenues,
      freeVenues,
      proVenues,
      premiumVenues,
      paidVenues,
      churnedVenuesAllTime,
      monetizationRate:   safeDivide(paidVenues, seededSubmittedNonChurned),
      claimToPaid:        safeDivide(paidVenues, claimedVenues),
      freeToPro:           safeDivide(proVenues, freeVenues + proVenues),
      proToPremium:        safeDivide(premiumVenues, proVenues + premiumVenues),
      upgradesLast30d,
      downgradesLast30d,
      churnLast30d,
    },

    consumerDemand: {
      venueViewsLast30d: sumViews(venueViewCounts),
      eventViewsLast30d: sumViews(eventViewCounts),
      topVenues,
      topEvents,
    },

    operationalSignals: {
      activeVenuesStillOnboarding: stillOnboarding,
      missingSetupItemInstances,
      upgradeOpportunities,
      inactiveOperators: n(r_inactiveOperators.count),
      highDemandVenues,
      highDemandEvents,
    },
  };
}
