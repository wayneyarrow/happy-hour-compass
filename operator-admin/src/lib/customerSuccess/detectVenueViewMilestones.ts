/**
 * Venue-view-milestone detector (Customer Success Phase 1A).
 *
 * Detection-only: this module records customer_success_events /
 * customer_success_baselines rows. It never sends an email, never touches
 * Resend, and is not wired to any scheduler — see this file's exports for
 * what Phase 1B can call later (runVenueViewMilestoneDetection() here;
 * getPendingCustomerSuccessEvents() in pendingEvents.ts to retrieve what's
 * ready to communicate).
 *
 * Split into computeVenueViewMilestoneDecisions() (read-only) and
 * applyVenueViewMilestoneDecisions() (writes) so a caller — namely
 * scripts/detectCustomerSuccessMilestones.ts — can preview what a run would
 * do before writing anything, matching this codebase's established
 * dry-run-before-apply convention for scripts that touch production data
 * (see CLAUDE.md, "Seeded Market Launch Prep"). runVenueViewMilestoneDetection()
 * composes both for the common case (detect and record in one call).
 *
 * SOURCE OF TRUTH: all-time venue view counts come from
 * getVenueViewCounts(null, venueIds) (src/lib/data/viewCounts.ts) — the same
 * venue_view_counts() RPC (migration 088) over venue_view_events
 * (migration 042) that backs the Founder Control Panel's all-time Consumer
 * Demand figures. No second view counter is introduced.
 *
 * IDEMPOTENCY: resolveVenueViewMilestoneDecision() (venueViewMilestones.ts)
 * computes what's new relative to what's already recorded, and every insert
 * here targets a table with a partial unique index (migration 093) — a
 * concurrent/duplicate run's insert fails with Postgres 23505
 * (unique_violation), which applyVenueViewMilestoneDecisions() treats as
 * "already recorded", not an error. Safe to invoke repeatedly.
 *
 * CROSS-RUN SUPERSESSION: a milestone that went 'pending' on an earlier run
 * can be superseded by a later run before it's sent (e.g. 50 pending at 52
 * views, then 100 crossed by the next run at 103 views).
 * applyVenueViewMilestoneDecisions() demotes any such existing 'pending'
 * row to 'superseded' via a conditional UPDATE — `WHERE communication_status
 * = 'pending'` — BEFORE inserting the new 'pending' row, both because that
 * ordering is what customer_success_events_one_pending_uidx (migration 093)
 * requires (it rejects a second simultaneous 'pending' row outright) and
 * because the status guard means a row that has meanwhile actually been
 * sent is never touched, race or not.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { getVenueViewCounts } from "@/lib/data/viewCounts";
import { getEligibleVenues, type EligibleVenue } from "./eligibility";
import { fetchAllRows } from "./pagination";
import { resolveVenueViewMilestoneDecision, type VenueViewMilestoneDecision } from "./venueViewMilestones";
import type { CustomerSuccessEventType } from "./types";

const EVENT_TYPE: CustomerSuccessEventType = "venue_view_milestone";

type AdminClient = ReturnType<typeof createAdminClient>;

export type VenueViewMilestonePlanEntry = {
  venue: EligibleVenue;
  currentViews: number;
  decision: VenueViewMilestoneDecision;
};

export type VenueViewMilestonePlan = {
  venuesEvaluated: number;
  venuesIgnoredIneligible: number;
  entries: VenueViewMilestonePlanEntry[];
};

export type VenueViewMilestoneDetectionResult = {
  /** Eligible venues the detector considered this run. */
  venuesEvaluated: number;
  /** Venues excluded by the Section 3 eligibility rule (unpublished, seeded/unclaimed, etc. — see eligibility.ts). */
  venuesIgnoredIneligible: number;
  /** New customer_success_baselines rows written (first observation of a venue — see venueViewMilestones.ts). */
  venuesBaselined: number;
  /** New customer_success_events rows written with communication_status = 'pending'. */
  milestonesNewlyAchieved: number;
  /** New customer_success_events rows inserted directly with communication_status = 'superseded'. */
  milestonesSuperseded: number;
  /** Existing 'pending' rows from an earlier run demoted to 'superseded' this run (cross-run supersession). */
  pendingMilestonesSuperseded: number;
  /** Per-venue failures. A unique-violation race is NOT reported here — it's treated as an idempotent no-op. */
  errors: { venueId: string; message: string }[];
};

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

/**
 * Read-only: fetches every eligible venue's current all-time view count and
 * already-recorded state, and computes what this run WOULD do — without
 * writing anything. Safe to call as often as desired (e.g. for a dry-run
 * preview); has no side effects.
 */
export async function computeVenueViewMilestoneDecisions(
  admin: AdminClient = createAdminClient()
): Promise<VenueViewMilestonePlan> {
  const { count: totalVenueCount, error: countError } = await admin
    .from("venues")
    .select("*", { count: "exact", head: true });
  if (countError) throw new Error(`Failed to count venues: ${countError.message}`);

  const eligibleVenues = await getEligibleVenues(admin);
  const venuesIgnoredIneligible = Math.max((totalVenueCount ?? 0) - eligibleVenues.length, 0);

  if (eligibleVenues.length === 0) {
    return { venuesEvaluated: 0, venuesIgnoredIneligible, entries: [] };
  }

  const venueIds = eligibleVenues.map((v) => v.id);

  const viewCounts = await getVenueViewCounts(null, venueIds, admin);

  const [existingEvents, existingBaselines] = await Promise.all([
    fetchAllRows<{ venue_id: string; milestone_value: number | null; communication_status: string }>(
      (from, to) =>
        admin
          .from("customer_success_events")
          .select("venue_id, milestone_value, communication_status")
          .eq("event_type", EVENT_TYPE)
          .in("venue_id", venueIds)
          .range(from, to)
    ),
    fetchAllRows<{ venue_id: string }>((from, to) =>
      admin
        .from("customer_success_baselines")
        .select("venue_id")
        .eq("event_type", EVENT_TYPE)
        .in("venue_id", venueIds)
        .range(from, to)
    ),
  ]);

  const recordedMilestonesByVenue = new Map<string, Set<number>>();
  const pendingMilestonesByVenue = new Map<string, number[]>();
  for (const row of existingEvents) {
    if (row.milestone_value === null) continue;
    const set = recordedMilestonesByVenue.get(row.venue_id) ?? new Set<number>();
    set.add(row.milestone_value);
    recordedMilestonesByVenue.set(row.venue_id, set);

    if (row.communication_status === "pending") {
      const pending = pendingMilestonesByVenue.get(row.venue_id) ?? [];
      pending.push(row.milestone_value);
      pendingMilestonesByVenue.set(row.venue_id, pending);
    }
  }

  const baselinedVenueIds = new Set(existingBaselines.map((r) => r.venue_id));

  const entries: VenueViewMilestonePlanEntry[] = eligibleVenues.map((venue) => {
    const currentViews = viewCounts.get(venue.id) ?? 0;
    const alreadyRecorded = [...(recordedMilestonesByVenue.get(venue.id) ?? new Set<number>())];
    const pendingMilestones = pendingMilestonesByVenue.get(venue.id) ?? [];
    const hasBaseline = baselinedVenueIds.has(venue.id);

    const decision = resolveVenueViewMilestoneDecision({
      currentViews,
      alreadyRecordedMilestones: alreadyRecorded,
      pendingMilestones,
      hasBaseline,
    });

    return { venue, currentViews, decision };
  });

  return { venuesEvaluated: eligibleVenues.length, venuesIgnoredIneligible, entries };
}

/**
 * Writes the given plan's decisions. Idempotent — see module header.
 * Recomputing a fresh plan immediately before calling this (rather than
 * reusing a stale one) is recommended for any caller that waits between
 * compute and apply, so a concurrent run's writes are reflected; a stale
 * plan is still safe, just relies on the unique-violation fallback more.
 */
export async function applyVenueViewMilestoneDecisions(
  plan: VenueViewMilestonePlan,
  admin: AdminClient = createAdminClient()
): Promise<VenueViewMilestoneDetectionResult> {
  const result: VenueViewMilestoneDetectionResult = {
    venuesEvaluated: plan.venuesEvaluated,
    venuesIgnoredIneligible: plan.venuesIgnoredIneligible,
    venuesBaselined: 0,
    milestonesNewlyAchieved: 0,
    milestonesSuperseded: 0,
    pendingMilestonesSuperseded: 0,
    errors: [],
  };

  for (const { venue, currentViews, decision } of plan.entries) {
    try {
      if (decision.baselineNeeded) {
        const { error } = await admin.from("customer_success_baselines").insert({
          venue_id: venue.id,
          event_type: EVENT_TYPE,
          metric_value_at_baseline: currentViews,
        });
        if (error) {
          if (!isUniqueViolation(error)) throw new Error(error.message);
          // Already baselined by a concurrent run — fall through and still
          // attempt the milestone writes below (they're independently
          // idempotent).
        } else {
          result.venuesBaselined++;
        }
      }

      // Demote any still-pending milestone from an earlier run BEFORE
      // inserting a new 'pending' row below — required both by
      // customer_success_events_one_pending_uidx (migration 093, which
      // would otherwise reject the new 'pending' insert while the old one
      // still holds that status) and so a concurrent send that already
      // flipped the row to 'sent' is left untouched (the UPDATE's
      // `communication_status = 'pending'` guard simply matches 0 rows).
      for (const milestone of decision.pendingToSupersede) {
        const { data, error } = await admin
          .from("customer_success_events")
          .update({ communication_status: "superseded" })
          .eq("venue_id", venue.id)
          .eq("event_type", EVENT_TYPE)
          .eq("milestone_value", milestone)
          .eq("communication_status", "pending")
          .select("id");

        if (error) throw new Error(error.message);
        if (data && data.length > 0) result.pendingMilestonesSuperseded += data.length;
      }

      const rowsToInsert: { milestone: number; status: "pending" | "superseded" }[] = [
        ...decision.newlySuperseded.map((m) => ({ milestone: m, status: "superseded" as const })),
        ...(decision.newlyPending !== null
          ? [{ milestone: decision.newlyPending, status: "pending" as const }]
          : []),
      ];

      for (const row of rowsToInsert) {
        const { error } = await admin.from("customer_success_events").insert({
          venue_id: venue.id,
          operator_id: venue.operatorId,
          event_type: EVENT_TYPE,
          milestone_value: row.milestone,
          metric_value_at_detection: currentViews,
          communication_status: row.status,
        });

        if (error) {
          if (isUniqueViolation(error)) continue; // already recorded — idempotent no-op
          throw new Error(error.message);
        }

        if (row.status === "pending") result.milestonesNewlyAchieved++;
        else result.milestonesSuperseded++;
      }
    } catch (err) {
      result.errors.push({
        venueId: venue.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Runs one full detection pass (compute + apply) over every eligible venue.
 * Safe to call repeatedly/on a schedule — see module header for
 * idempotency. Phase 1A does not schedule this; it is a plain callable for
 * manual/test invocation (scripts/detectCustomerSuccessMilestones.ts) and
 * for Phase 1B to later invoke from whatever scheduler it adds.
 */
export async function runVenueViewMilestoneDetection(
  admin: AdminClient = createAdminClient()
): Promise<VenueViewMilestoneDetectionResult> {
  const plan = await computeVenueViewMilestoneDecisions(admin);
  return applyVenueViewMilestoneDecisions(plan, admin);
}
