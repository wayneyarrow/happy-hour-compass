/**
 * Comp / Trial access report — Action Center (Part 1).
 *
 * Deliberately a standalone module (not part of actionCenter.ts) so it can
 * move to a future Customer Success area unchanged. Read-only; never touches
 * billing. Billing plan follows Action Center's existing resolution
 * (buildVenuePlanMap: cancelled → Free, past_due stays paid).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { buildVenuePlanMap, type VenueSubRow } from "@/lib/data/actionCenter";
import { getPlanGrantsForVenues } from "@/lib/planGrants/server";
import {
  getGrantStatus,
  grantEffectiveEnd,
  grantLabel,
  resolveEffectiveAccess,
  type GrantStatus,
  type GrantType,
  type GrantPlan,
} from "@/lib/planGrants/grantState";
import { daysUntil } from "@/lib/planGrants/grantDates";
import type { OperatorPlan } from "@/lib/plans";

/** "Ending soon" window for the summary card and report highlighting. */
export const GRANT_ENDING_SOON_DAYS = 14;
/** Recently-ended grants stay visible this long (follow-up / conversion). */
export const GRANT_RECENTLY_ENDED_DAYS = 30;

export type PlanGrantReportRow = {
  grantId: string;
  venueId: string;
  venueName: string;
  city: string | null;
  label: string;
  planCode: GrantPlan;
  grantType: GrantType;
  status: GrantStatus;
  startsAt: string;
  /** Exclusive end of access (ends_at, or revocation time). Null = no expiry. */
  endsAt: string | null;
  /** Days of access remaining for active grants with an end date. */
  daysRemaining: number | null;
  endingSoon: boolean;
  billingPlan: OperatorPlan;
  effectivePlan: OperatorPlan;
  /** True when no paid billing plan exists (the grant is the only access). */
  nonPaying: boolean;
  reason: string;
  createdByEmail: string;
};

export type PlanGrantReportSummary = {
  /** Active + scheduled grants (the card's primary count). */
  open: number;
  active: number;
  scheduled: number;
  endingSoon: number;
};

const RELEVANT: GrantStatus[] = ["active", "scheduled", "expired", "revoked", "ended_ownership_changed", "ended_venue_cancelled", "invalidated"];

/**
 * Comp/Trial report rows. Null = the lookup FAILED (the page and Action
 * Center card show an error / "—", never "no grants").
 */
export async function getPlanGrantReport(nowMs: number = Date.now()): Promise<PlanGrantReportRow[] | null> {
  const supabase = createAdminClient();
  const { data: grantVenueRows, error } = await supabase.from("venue_plan_grants").select("venue_id");
  if (error) {
    console.error("[getPlanGrantReport]", error.message);
    return null;
  }
  const venueIds = [...new Set(((grantVenueRows ?? []) as { venue_id: string }[]).map((r) => r.venue_id))];
  if (venueIds.length === 0) return [];

  const [{ ok: grantsOk, grantsByVenue, ownershipByVenue }, venuesRes, subsRes] = await Promise.all([
    getPlanGrantsForVenues(venueIds, supabase),
    supabase.from("venues").select("id, name, city").in("id", venueIds),
    supabase.from("venue_subscriptions").select("venue_id, plan_code, status").in("venue_id", venueIds),
  ]);

  if (!grantsOk || venuesRes.error || subsRes.error) {
    console.error("[getPlanGrantReport] partial read failed", venuesRes.error?.message ?? subsRes.error?.message ?? "grants");
    return null;
  }

  const venueById = new Map(
    ((venuesRes.data ?? []) as { id: string; name: string; city: string | null }[]).map((v) => [v.id, v])
  );
  const billingMap = buildVenuePlanMap((subsRes.data ?? []) as VenueSubRow[]);

  const rows: PlanGrantReportRow[] = [];
  for (const [venueId, grants] of grantsByVenue) {
    const ownership = ownershipByVenue.get(venueId) ?? { createdByOperatorId: null, claimedAt: null };
    const billingPlan = billingMap.get(venueId) ?? "free";
    const access = resolveEffectiveAccess({ billingPlan, grants, venue: ownership, nowMs });
    const venue = venueById.get(venueId);

    for (const grant of grants) {
      const status = getGrantStatus(grant, ownership, nowMs);
      if (!RELEVANT.includes(status)) continue;
      const end = grantEffectiveEnd(grant);
      const isOpen = status === "active" || status === "scheduled";
      if (!isOpen) {
        const endedMs = end ? Date.parse(end) : nowMs;
        if (nowMs - endedMs > GRANT_RECENTLY_ENDED_DAYS * 86_400_000) continue;
      }
      const daysRemaining = status === "active" && grant.endsAt ? daysUntil(grant.endsAt, nowMs) : null;
      rows.push({
        grantId: grant.id,
        venueId,
        venueName: venue?.name ?? venueId,
        city: venue?.city ?? null,
        label: grantLabel(grant),
        planCode: grant.planCode,
        grantType: grant.grantType,
        status,
        startsAt: grant.startsAt,
        endsAt: end,
        daysRemaining,
        endingSoon: daysRemaining !== null && daysRemaining <= GRANT_ENDING_SOON_DAYS,
        billingPlan,
        effectivePlan: access.effectivePlan,
        nonPaying: billingPlan === "free",
        reason: grant.reason,
        createdByEmail: grant.createdByEmail,
      });
    }
  }

  // Open grants first (soonest end first, open-ended last), then recently ended (newest first).
  const rank = (r: PlanGrantReportRow) => (r.status === "active" ? 0 : r.status === "scheduled" ? 1 : 2);
  return rows.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const ea = a.endsAt ? Date.parse(a.endsAt) : Infinity;
    const eb = b.endsAt ? Date.parse(b.endsAt) : Infinity;
    return rank(a) < 2 ? ea - eb : eb - ea;
  });
}

export function summarizePlanGrantReport(rows: PlanGrantReportRow[]): PlanGrantReportSummary {
  const active = rows.filter((r) => r.status === "active").length;
  const scheduled = rows.filter((r) => r.status === "scheduled").length;
  return { open: active + scheduled, active, scheduled, endingSoon: rows.filter((r) => r.endingSoon).length };
}
