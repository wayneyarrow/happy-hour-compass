/**
 * Venue Funnel V1 — Founder Control Panel Kanban view of the venue lifecycle.
 *
 * Answers "where are venues in their lifecycle?" — a complement to Action
 * Center's "what needs attention?" (src/lib/data/actionCenter.ts). Every
 * business rule below is reused from existing, already-canonical logic —
 * this file does not reimplement onboarding, plan resolution, or the
 * upgrade-opportunity rule; it only classifies venues into lanes and shapes
 * them for card display.
 *
 * Reused directly (not duplicated):
 *   - computeSetupHealth() / VENUE_SELECT / VenueWithSetup / INACTIVE_DAYS
 *     (src/lib/data/actionCenter.ts) — the exact same setup-health,
 *     onboarding-completion, and inactivity-threshold logic Action Center
 *     already uses.
 *   - buildVenuePlanMap() / VenueSubRow (src/lib/data/actionCenter.ts) —
 *     the Phase 2B venue-level plan resolver (venue_subscriptions is the
 *     sole source; cancelled → Free; past_due stays paid).
 *   - getUpgradeOpportunities() (src/lib/data/actionCenter.ts) — called
 *     once (not per-venue) to get the exact set of venues Action Center
 *     already considers upgrade opportunities, so the two surfaces can
 *     never disagree.
 *   - daysSince() (src/lib/data/actionCenter.ts).
 *
 * ── Lane precedence (one venue = exactly one primary lane) ──────────────────
 * Evaluated in this order — first match wins, later/more-advanced states
 * outrank earlier ones:
 *   1. paid_plan             — resolved plan is a paid tier (via
 *                               buildVenuePlanMap, which already folds
 *                               'cancelled' subscriptions to Free)
 *   2. upgrade_opportunity    — venue id is in the Set returned by a single
 *                               getUpgradeOpportunities() call
 *   3. onboarding_complete    — computeVenueSetupStatus().onboardingComplete
 *                               (automatic OR Phase 1B manual override)
 *   4. onboarding_in_progress — account activated, onboarding incomplete,
 *                               but at least one of the 6 automatic signals
 *                               (published/HH times/business hours/photo/
 *                               food/drink) is satisfied
 *   5. account_created        — account activated, onboarding incomplete,
 *                               ALL 6 automatic signals still missing
 *   6. setup_stalled          — account NOT activated, >= SETUP_STALLED_AFTER_DAYS
 *                               since claimed_at
 *   7. setup_sent             — account NOT activated, < SETUP_STALLED_AFTER_DAYS
 *                               since claimed_at
 * Entry cards (claim_submitted / venue_submitted) are NOT part of this
 * per-venue chain — they represent a claim/submission that has not yet
 * produced an activated venue relationship at all (no venues row exists yet,
 * or the row exists but is still unclaimed). A claim/submission whose target
 * venue has since become claimed by any path is excluded from Entry so it is
 * never shown twice (see the claimed-venue-id filter below).
 *
 * Publication (is_published) is never part of this precedence chain — it is
 * card metadata only, exactly per the Phase 2 product decision that
 * publication is an attribute, not a funnel stage.
 */

import { createAdminClient } from "@/lib/supabase/server";
import {
  computeSetupHealth,
  buildVenuePlanMap,
  getUpgradeOpportunities,
  daysSince,
  VENUE_SELECT,
  INACTIVE_DAYS,
  type VenueWithSetup,
  type VenueSubRow,
} from "@/lib/data/actionCenter";
import type { OnboardingCompletionMode } from "@/lib/homepagePhase";
import type { OperatorPlan } from "@/lib/plans";
import type { VenueSubscriptionStatus } from "@/lib/venueSubscriptions";

// ── Product-decision constants ────────────────────────────────────────────────

/** Phase 2C product decision — see task spec. Named, not a scattered magic number. */
export const SETUP_STALLED_AFTER_DAYS = 3;

/**
 * Phase 2E — historical Funnel start boundary.
 *
 * HHC's venue_claims/operator_submissions tables carry records from the
 * pre-launch development/testing period (throwaway test emails like
 * "hoho@hslkjash.com", clustered within a few hours on 2026-04-02) —
 * legitimate history, but not real venue-lifecycle activity. The Placery
 * (operator_submissions.id = 6de945ea-a3b7-4283-bc0d-e84061df871f,
 * submitted_at = 2026-08-15T17:05:29.215Z) is the first real HHC operator
 * submission and marks the true beginning of the Venue Funnel.
 *
 * Scope: this boundary applies ONLY to the two raw Entry-state queries
 * (venue_claims.created_at, operator_submissions.submitted_at) — it is
 * INCLUSIVE (The Placery itself must remain eligible) and is intentionally
 * NOT applied to venues.created_at anywhere. Many legitimate venues were
 * seeded before this date and are legitimately claimed/onboarding today;
 * excluding them by venue creation date would remove real inventory, not
 * historical noise. See getVenueFunnelData()'s active-venues query, which
 * deliberately does not reference this constant at all.
 *
 * Named and centralized here — never duplicate this literal timestamp
 * elsewhere in this file or scatter it across multiple queries.
 */
export const VENUE_FUNNEL_START_AT = "2026-08-15T17:05:29.215Z";

// ── Entry-state status lists (Phase 2A-verified exact enums) ─────────────────

/**
 * venue_claims rows in one of these statuses are still in the active,
 * pre-approval review flow and have not yet produced an activated venue
 * relationship. The full status enum (migrations 007 + 024) is exactly:
 *   pending | needs_more_info | info_submitted | approved | rejected
 * — i.e. these 3 are the complete set of active/pre-approval states; the
 * other 2 (approved/rejected) are terminal and must never appear here.
 * needs_more_info/info_submitted must remain included: a claim moving
 * through the structured more-info flow (Founder/Admin requests more info,
 * claimant submits it) is still an active claim awaiting a decision — it
 * must not silently disappear from the funnel while in that state.
 */
const ACTIVE_CLAIM_STATUSES = ["pending", "needs_more_info", "info_submitted"];

/**
 * operator_submissions rows in one of these statuses have NOT yet produced
 * an activated venue relationship. Explicitly excludes 'confirmed_auto'
 * (already auto-provisioned in the same request — see suggest/owner/
 * actions.ts — so it immediately becomes a claimed venue, never sitting in
 * this list), 'double_claim' (the matched venue is already claimed by
 * someone else — a conflict, not a fresh submission-in-progress), and every
 * rejected/closed/converted terminal status.
 */
const ACTIVE_SUBMISSION_STATUSES = ["new", "no_match", "pending_review", "info_submitted", "needs_more_info"];

// ── Types ──────────────────────────────────────────────────────────────────────

export type FunnelLaneKey =
  | "claim_submitted"
  | "venue_submitted"
  | "setup_sent"
  | "setup_stalled"
  | "account_created"
  | "onboarding_in_progress"
  | "onboarding_complete"
  | "upgrade_opportunity"
  | "paid_plan";

export const LANE_ORDER: FunnelLaneKey[] = [
  "claim_submitted",
  "venue_submitted",
  "setup_sent",
  "setup_stalled",
  "account_created",
  "onboarding_in_progress",
  "onboarding_complete",
  "upgrade_opportunity",
  "paid_plan",
];

export const LANE_LABELS: Record<FunnelLaneKey, string> = {
  claim_submitted:        "Claim Submitted",
  venue_submitted:        "Venue Submitted",
  setup_sent:             "Setup Sent — Awaiting Account",
  setup_stalled:          "Setup Stalled / No Response",
  account_created:        "Account Created — Not Started",
  onboarding_in_progress: "Onboarding In Progress",
  onboarding_complete:    "Onboarding Complete",
  upgrade_opportunity:    "Upgrade Opportunity",
  paid_plan:              "Paid Plan",
};

export type VenueFunnelCard = {
  laneKey: FunnelLaneKey;
  /** venue id for activated-venue lanes; claim/submission id for Entry lanes. */
  id: string;
  kind: "venue" | "claim" | "submission";
  name: string;
  city: string | null;

  /** /control-panel/venues/[id] — only when a real, activated venue row exists. */
  venueDetailUrl: string | null;
  /** /control-panel/claims/[id] or /control-panel/operator-submissions/[id] — Entry cards only. */
  reviewUrl: string | null;

  isPublished: boolean | null;

  plan: OperatorPlan | null;
  subscriptionStatus: VenueSubscriptionStatus | null;

  onboardingCompletionMode: OnboardingCompletionMode | null;
  setupHealthScorePct: number | null;
  missingItemsCount: number | null;

  operatorName: string | null;
  operatorEmail: string | null;
  operatorLastSeenAt: string | null;
  accountActivatedAt: string | null;

  /** venues.source for venue cards ("seed"/"operator_submission"/...); "claim"/"operator_submission" for Entry cards. */
  origin: string | null;

  /**
   * Raw venue_claims.status for Claim Submitted cards only (pending /
   * needs_more_info / info_submitted) — null for every other card. The lane
   * itself stays "Claim Submitted" regardless of which of these three
   * statuses the claim is in; this exists purely so the UI can show a
   * compact status badge explaining exactly where the claim sits within
   * that lane, per the Phase 2C product decision not to split it into
   * multiple lanes.
   */
  claimStatus: string | null;

  /** Elapsed days since the one reliable start timestamp for this lane. Null when none exists — never fabricated. */
  ageDays: number | null;
  /** What ageDays is measured from, e.g. "Since claim submitted" — for UI clarity. Null iff ageDays is null. */
  ageLabel: string | null;

  /**
   * Onboarding In Progress only — a soft, informational signal (never a
   * lane) that both venues.updated_at and the operator's last_seen_at are
   * older than INACTIVE_DAYS (the same threshold Action Center already uses
   * for "inactive operators"). Always false for every other lane.
   */
  possiblyInactive: boolean;
};

export type FunnelLane = {
  key: FunnelLaneKey;
  label: string;
  cards: VenueFunnelCard[];
};

export type VenueFunnelData = {
  lanes: FunnelLane[];
  generatedAt: string;
};

// ── Row types ──────────────────────────────────────────────────────────────────

type OperatorRow = {
  id: string;
  email: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  last_seen_at: string | null;
  account_activated_at: string | null;
};

type ClaimRow = {
  id: string;
  venue_id: string;
  first_name: string;
  last_name: string;
  email: string;
  created_at: string;
  status: string;
  venues: { name: string | null; city: string | null; claimed_at: string | null } | { name: string | null; city: string | null; claimed_at: string | null }[] | null;
};

type SubmissionRow = {
  id: string;
  venue_name: string;
  city: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  submitted_at: string;
  venue_id: string | null;
};

function operatorName(op: OperatorRow | undefined): string | null {
  if (!op) return null;
  return op.name || [op.first_name, op.last_name].filter(Boolean).join(" ") || op.email;
}

/** Supabase returns an embedded to-one relation as an object or (without generated types) sometimes an array — normalize both. */
function firstEmbedded<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

// ── Pure lane-precedence logic ─────────────────────────────────────────────
//
// Extracted with no I/O of its own — same rationale as
// resolvePlanCodeFromVenueSubscription() (src/lib/venueSubscriptions.ts) and
// computeActiveVenueId() (src/lib/impersonation.ts): the one piece of "which
// lane does this venue belong in" logic that can be unit-tested directly
// with real function calls, rather than only via a static source-text check
// on getVenueFunnelData()'s DB-backed body.
//
// Precedence (first match wins, later outranks earlier) — see file header
// for the full rationale of each rule:
//   1. paid_plan              — plan !== "free" (buildVenuePlanMap already
//                                folds a cancelled subscription to Free)
//   2. upgrade_opportunity    — isUpgradeOpportunity
//   3. onboarding_complete    — onboardingComplete (automatic or manual)
//   4. onboarding_in_progress — account activated, some (not all 6) signals done
//   5. account_created        — account activated, zero (0 of 6) signals done
//   6. setup_stalled          — account not activated, >= SETUP_STALLED_AFTER_DAYS
//   7. setup_sent             — account not activated, < SETUP_STALLED_AFTER_DAYS
export type VenueLaneClassificationInput = {
  plan: OperatorPlan;
  isUpgradeOpportunity: boolean;
  onboardingComplete: boolean;
  /** Count of the 6 automatic onboarding signals still missing (0-6). */
  missingItemsCount: number;
  accountActivatedAt: string | null;
  claimedAt: string | null;
  updatedAt: string;
  operatorLastSeenAt: string | null;
};

export type VenueLaneClassification = {
  laneKey: FunnelLaneKey;
  ageDays: number | null;
  ageLabel: string | null;
  possiblyInactive: boolean;
};

export function classifyVenueLane(input: VenueLaneClassificationInput): VenueLaneClassification {
  let laneKey: FunnelLaneKey;
  let ageDays: number | null = null;
  let ageLabel: string | null = null;

  if (input.plan !== "free") {
    laneKey = "paid_plan";
  } else if (input.isUpgradeOpportunity) {
    laneKey = "upgrade_opportunity";
  } else if (input.onboardingComplete) {
    laneKey = "onboarding_complete";
  } else if (input.accountActivatedAt) {
    laneKey = input.missingItemsCount < 6 ? "onboarding_in_progress" : "account_created";
    ageDays = daysSince(input.accountActivatedAt);
    ageLabel = ageDays !== null ? "Since account activated" : null;
  } else {
    // Account not yet activated — Setup Sent vs. Setup Stalled, keyed off
    // claimed_at (see operatorActivation.ts's provisionOperatorForVenue —
    // claimed_at is set atomically with the setup email send, so it is a
    // reliable proxy for "setup invitation successfully sent").
    const claimedDays = daysSince(input.claimedAt);
    laneKey = claimedDays !== null && claimedDays >= SETUP_STALLED_AFTER_DAYS ? "setup_stalled" : "setup_sent";
    ageDays = claimedDays;
    ageLabel = ageDays !== null ? "Since setup sent" : null;
  }

  const possiblyInactive =
    laneKey === "onboarding_in_progress" &&
    (daysSince(input.updatedAt) ?? 0) >= INACTIVE_DAYS &&
    (input.operatorLastSeenAt == null || (daysSince(input.operatorLastSeenAt) ?? 0) >= INACTIVE_DAYS);

  return { laneKey, ageDays, ageLabel, possiblyInactive };
}

// ── Main data fetch ────────────────────────────────────────────────────────────

export async function getVenueFunnelData(): Promise<VenueFunnelData> {
  const supabase = createAdminClient();

  const [r_claims, r_submissions, r_venues] = await Promise.all([
    supabase
      .from("venue_claims")
      .select("id, venue_id, first_name, last_name, email, created_at, status, venues(name, city, claimed_at)")
      .in("status", ACTIVE_CLAIM_STATUSES)
      .gte("created_at", VENUE_FUNNEL_START_AT),
    supabase
      .from("operator_submissions")
      .select("id, venue_name, city, first_name, last_name, email, submitted_at, venue_id")
      .in("status", ACTIVE_SUBMISSION_STATUSES)
      .gte("submitted_at", VENUE_FUNNEL_START_AT),
    // NOT filtered by VENUE_FUNNEL_START_AT — see that constant's doc
    // comment. Many legitimate venues were seeded before the Funnel start
    // and are legitimately claimed/onboarding today; the boundary excludes
    // pre-launch Entry-state test noise only, never downstream inventory.
    supabase
      .from("venues")
      .select(VENUE_SELECT)
      .not("created_by_operator_id", "is", null),
  ]);

  const claims = (r_claims.data ?? []) as unknown as ClaimRow[];
  const submissions = (r_submissions.data ?? []) as SubmissionRow[];
  const activeVenues = (r_venues.data ?? []) as VenueWithSetup[];

  const activeVenueIds = activeVenues.map((v) => v.id);
  const opIds = [...new Set(activeVenues.map((v) => v.created_by_operator_id).filter((id): id is string => !!id))];

  // pending_review submissions carry a real (still-unclaimed) venue_id — the
  // one Entry case with a venue row already in existence. Batch-check those
  // specific venues' claimed_at so a submission whose venue has since been
  // claimed via some other path is never shown as an Entry card AND as an
  // activated venue at the same time.
  const submissionVenueIds = submissions.map((s) => s.venue_id).filter((id): id is string => !!id);
  const { data: submissionVenuesData } =
    submissionVenueIds.length > 0
      ? await supabase.from("venues").select("id, claimed_at").in("id", submissionVenueIds)
      : { data: [] as { id: string; claimed_at: string | null }[] };
  const submissionVenueClaimedAt = new Map(
    ((submissionVenuesData ?? []) as { id: string; claimed_at: string | null }[]).map((v) => [v.id, v.claimed_at])
  );

  const [r_media, r_subs, r_ops] = await Promise.all([
    activeVenueIds.length > 0
      ? supabase.from("media").select("venue_id, url").in("venue_id", activeVenueIds).eq("type", "venue_image")
      : Promise.resolve({ data: [] as { venue_id: string; url: string }[] }),
    activeVenueIds.length > 0
      ? supabase.from("venue_subscriptions").select("venue_id, plan_code, status").in("venue_id", activeVenueIds)
      : Promise.resolve({ data: [] as VenueSubRow[] }),
    opIds.length > 0
      ? supabase
          .from("operators")
          .select("id, email, name, first_name, last_name, last_seen_at, account_activated_at")
          .in("id", opIds)
      : Promise.resolve({ data: [] as OperatorRow[] }),
  ]);

  const mediaByVenue = new Map<string, string[]>();
  for (const { venue_id, url } of (r_media.data ?? []) as { venue_id: string; url: string }[]) {
    const list = mediaByVenue.get(venue_id) ?? [];
    list.push(url);
    mediaByVenue.set(venue_id, list);
  }

  const planMap = buildVenuePlanMap((r_subs.data ?? []) as VenueSubRow[]);
  const subStatusByVenue = new Map(
    ((r_subs.data ?? []) as VenueSubRow[]).map((r) => [r.venue_id, r.status as VenueSubscriptionStatus | null])
  );

  const opById = new Map<string, OperatorRow>();
  for (const op of (r_ops.data ?? []) as OperatorRow[]) opById.set(op.id, op);

  // One extra batched call (not per-venue) reusing Action Center's exact,
  // already-reviewed Upgrade Opportunity business rule — never
  // reimplemented here. See file header.
  const upgradeOpportunityVenueIds = new Set((await getUpgradeOpportunities()).map((r) => r.id));

  // ── Entry: Claim Submitted ──────────────────────────────────────────────
  const claimCards: VenueFunnelCard[] = claims
    .filter((c) => (firstEmbedded(c.venues)?.claimed_at ?? null) === null)
    .map((c) => {
      const venue = firstEmbedded(c.venues);
      const ageDays = daysSince(c.created_at);
      return {
        laneKey: "claim_submitted",
        id: c.id,
        kind: "claim",
        name: venue?.name ?? "Unknown venue",
        city: venue?.city ?? null,
        venueDetailUrl: null,
        reviewUrl: `/control-panel/claims/${c.id}`,
        isPublished: null,
        plan: null,
        subscriptionStatus: null,
        onboardingCompletionMode: null,
        setupHealthScorePct: null,
        missingItemsCount: null,
        operatorName: [c.first_name, c.last_name].filter(Boolean).join(" ") || null,
        operatorEmail: c.email,
        operatorLastSeenAt: null,
        accountActivatedAt: null,
        origin: "claim",
        claimStatus: c.status,
        ageDays,
        ageLabel: ageDays !== null ? "Since claim submitted" : null,
        possiblyInactive: false,
      };
    });

  // ── Entry: Venue Submitted ───────────────────────────────────────────────
  const submissionCards: VenueFunnelCard[] = submissions
    .filter((s) => !s.venue_id || (submissionVenueClaimedAt.get(s.venue_id) ?? null) === null)
    .map((s) => {
      const ageDays = daysSince(s.submitted_at);
      return {
        laneKey: "venue_submitted",
        id: s.id,
        kind: "submission",
        name: s.venue_name,
        city: s.city,
        venueDetailUrl: null,
        reviewUrl: `/control-panel/operator-submissions/${s.id}`,
        isPublished: null,
        plan: null,
        subscriptionStatus: null,
        onboardingCompletionMode: null,
        setupHealthScorePct: null,
        missingItemsCount: null,
        operatorName: [s.first_name, s.last_name].filter(Boolean).join(" ") || null,
        operatorEmail: s.email,
        operatorLastSeenAt: null,
        accountActivatedAt: null,
        origin: "operator_submission",
        claimStatus: null,
        ageDays,
        ageLabel: ageDays !== null ? "Since submitted" : null,
        possiblyInactive: false,
      };
    });

  // ── Activated venues: classify into one primary lane each ────────────────
  const venueCards: VenueFunnelCard[] = activeVenues.map((v) => {
    const opId = v.created_by_operator_id;
    const op = opId ? opById.get(opId) : undefined;
    const plan = planMap.get(v.id) ?? "free";
    const isUpgradeOpportunity = upgradeOpportunityVenueIds.has(v.id);
    const { setupHealthScorePct, missingItems, onboardingComplete, onboardingCompletionMode } =
      computeSetupHealth(v, mediaByVenue);
    const accountActivatedAt = op?.account_activated_at ?? null;

    const { laneKey, ageDays, ageLabel, possiblyInactive } = classifyVenueLane({
      plan,
      isUpgradeOpportunity,
      onboardingComplete,
      missingItemsCount: missingItems.length,
      accountActivatedAt,
      claimedAt: v.claimed_at,
      updatedAt: v.updated_at,
      operatorLastSeenAt: op?.last_seen_at ?? null,
    });

    return {
      laneKey,
      id: v.id,
      kind: "venue",
      name: v.name,
      city: v.city,
      venueDetailUrl: `/control-panel/venues/${v.id}`,
      reviewUrl: null,
      isPublished: v.is_published,
      plan,
      subscriptionStatus: subStatusByVenue.get(v.id) ?? null,
      // onboardingCompletionMode is deliberately assigned here unconditionally
      // — NOT gated on laneKey in any way. A manual override is venue
      // metadata (Phase 1B), independent of which lane the venue's plan/
      // upgrade-eligibility/onboarding state currently places it in. A
      // manually-completed venue that also qualifies as an Upgrade
      // Opportunity, or that later goes Paid, keeps mode "manual" on its
      // card exactly the same as it would sitting in Onboarding Complete —
      // see venueFunnelLaneClassification.test.ts for the proof that
      // classifyVenueLane() has no knowledge of completion mode at all.
      onboardingCompletionMode,
      setupHealthScorePct,
      missingItemsCount: missingItems.length,
      operatorName: operatorName(op),
      operatorEmail: op?.email ?? null,
      operatorLastSeenAt: op?.last_seen_at ?? null,
      accountActivatedAt,
      origin: v.source,
      claimStatus: null,
      ageDays,
      ageLabel,
      possiblyInactive,
    };
  });

  const allCards = [...claimCards, ...submissionCards, ...venueCards];

  const lanes: FunnelLane[] = LANE_ORDER.map((key) => ({
    key,
    label: LANE_LABELS[key],
    cards: allCards.filter((c) => c.laneKey === key),
  }));

  return { lanes, generatedAt: new Date().toISOString() };
}
