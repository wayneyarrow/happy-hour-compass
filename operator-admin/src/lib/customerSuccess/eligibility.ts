/**
 * Venue eligibility for Customer Success events.
 *
 * ELIGIBILITY RULE (Published + Verified + Operator-managed):
 *   A venue is eligible when ALL of the following are true:
 *     - venues.is_published = true
 *     - venues.is_verified  = true
 *     - venues.created_by_operator_id IS NOT NULL
 *
 * WHY THESE THREE FIELDS — investigation findings:
 *
 *   `created_by_operator_id IS NOT NULL` is the "real, active, operator-
 *   owned venue" signal already used elsewhere in HHC for this exact
 *   distinction (src/lib/data/founderDashboard.ts's "Active venues" query,
 *   src/lib/data/actionCenter.ts's seeded/unclaimed vs. active buckets). A
 *   seeded, unclaimed venue (source = 'seed', created_by_operator_id IS
 *   NULL) never has this set. Cancelling venue management always sets
 *   is_published = false at the same time cancelled_at is stamped
 *   (migration 045_venue_cancellation.sql).
 *
 *   `is_verified` (venues.is_verified, migration 028_venues_is_verified.sql)
 *   is the platform's one dedicated verification signal — also the basis
 *   for the public "Verified Venue ✓" badge (see src/lib/data/dailySpecials.ts's
 *   comment on it). Crucially, is_verified is NOT implied by
 *   created_by_operator_id — they are set by different code paths:
 *
 *     - provisionOperatorForVenue() (src/lib/operatorActivation.ts) is the
 *       ONLY application code that ever writes is_verified — and it does so
 *       in the exact same UPDATE that sets claimed_by/claimed_at/
 *       created_by_operator_id, unconditionally `true`. This function runs
 *       for BOTH investigated paths:
 *         (1) Seeded/unclaimed → claimed → approved: a consumer/operator
 *             files a claim (venue_claims/claims, status starts unapproved);
 *             a founder approves it in Control Panel
 *             (app/control-panel/claims/[id]/actions.ts sets claim
 *             status='approved', then calls provisionOperatorForVenue) —
 *             which is the moment created_by_operator_id AND is_verified
 *             both flip together. Before approval, neither is set.
 *         (2) Operator-submitted venue → approved: an operator submission
 *             (operator_submissions.status, e.g. 'new' → 'approved' /
 *             'confirmed_auto') is approved in Control Panel
 *             (app/control-panel/operator-submissions/[id]/actions.ts),
 *             which likewise calls provisionOperatorForVenue and flips both
 *             fields together. Before approval, neither is set.
 *       So for a venue's FIRST operator (the one who actually claimed/
 *       activated it), is_published/is_verified/created_by_operator_id all
 *       become meaningful together at approval time — a claim or submission
 *       still awaiting approval leaves all three at their unapproved
 *       defaults (is_verified/is_published false, created_by_operator_id
 *       null), so this rule correctly excludes "pending approval/onboarding".
 *
 *     - Separately, is_verified = true also appears on some SEEDED venues
 *       with created_by_operator_id still NULL (see
 *       app/control-panel/action-center/reports/verified-no-operator/ —
 *       venues manually verified via the Happy Hour certification pass
 *       described in CLAUDE.md's "Seeded Market Launch Prep", independent
 *       of any claim). No application code path sets is_verified for these
 *       — it's a direct manual update as part of that offline review
 *       process. These are correctly excluded here by the
 *       created_by_operator_id check (verified, but not yet a real
 *       operator relationship).
 *
 * RESOLVED GAP — multi-venue operators' additional venues:
 *   createVenueAdminAction() (app/admin/venue/actions.ts) lets an already-
 *   activated operator create a SECOND (or further) venue directly from
 *   Operator Admin. This used to insert the new venue without is_verified,
 *   so a legitimately published, operator-owned second venue could have
 *   is_verified = false forever with no in-app way for a founder to fix it.
 *   Fixed directly at the source (createVenueAdminAction now sets
 *   is_verified: true at creation, mirroring provisionOperatorForVenue()'s
 *   timing for a first venue — see that action's own comment for the full
 *   reasoning) rather than special-cased here — this eligibility rule still
 *   requires the real is_verified column, unchanged.
 *
 * KNOWN GAP — "test venue":
 *   HHC has no canonical field marking a venue as a QA/test venue today (no
 *   is_test column, no test-market convention, no reserved operator
 *   allowlist for this purpose). This eligibility rule therefore cannot
 *   exclude one. If/when such a field is introduced, add it here — do not
 *   invent a naming convention (e.g. matching on venue name) to approximate
 *   it.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { fetchAllRows } from "./pagination";

export type VenueEligibilityInput = {
  isPublished: boolean;
  isVerified: boolean;
  createdByOperatorId: string | null;
};

/** Pure eligibility predicate — see the rule documented above. */
export function isEligibleForCustomerSuccess(venue: VenueEligibilityInput): boolean {
  return venue.isPublished && venue.isVerified && venue.createdByOperatorId !== null;
}

export type EligibleVenue = {
  id: string;
  /** Guaranteed non-null — the query only returns venues with created_by_operator_id set. */
  operatorId: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Fetches every eligible venue's id + owning operator id, paginated (see
 * pagination.ts — avoids the raw-row-fetch PostgREST row-return cap
 * documented in supabase/migrations/088_view_event_aggregation_rpcs.sql).
 *
 * Filters server-side rather than fetching every venue and applying
 * isEligibleForCustomerSuccess() in JS, so this scales with the number of
 * eligible venues, not the number of venues overall.
 */
export async function getEligibleVenues(admin: AdminClient): Promise<EligibleVenue[]> {
  const rows = await fetchAllRows<{ id: string; created_by_operator_id: string | null }>((from, to) =>
    admin
      .from("venues")
      .select("id, created_by_operator_id")
      .eq("is_published", true)
      .eq("is_verified", true)
      .not("created_by_operator_id", "is", null)
      .range(from, to)
  );

  return rows
    .filter((r) => r.created_by_operator_id !== null)
    .map((r) => ({ id: r.id, operatorId: r.created_by_operator_id as string }));
}
