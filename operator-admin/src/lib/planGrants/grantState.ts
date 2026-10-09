/**
 * Comp / Trial plan grants — pure state and effective-access resolution.
 *
 * Client-safe: no I/O, no server imports (imported by Control Panel client
 * components for labels/status). See supabase/migrations/109_venue_plan_grants.sql
 * for the schema and the authoritative write rules.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TWO SEPARATE CONCEPTS — never blended
 * ─────────────────────────────────────────────────────────────────────────
 *   Billing plan    — what the venue actually pays for. Read exactly as each
 *                     surface already reads it (venue_subscriptions). Stripe
 *                     is the only writer; grants never touch it.
 *   Effective plan  — what the venue can USE: the higher of the billing plan
 *                     and an active grant. A grant only ever lifts access,
 *                     so expiry/revocation can never downgrade a paying venue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PUBLIC CONTENT ENFORCEMENT (venue-scoped, approved Part 1 policy)
 * ─────────────────────────────────────────────────────────────────────────
 * A venue becomes a "grant recipient" the moment any grant has STARTED.
 * From then on its public content is limited to its current effective plan
 * — permanently, including after expiry, revocation, ownership change, and
 * a later paid subscription + cancellation. Venues that never had a started
 * grant keep today's behaviour (no public content limits) — untouched.
 *
 *   started ⇔ starts_at <= now AND (revoked_at IS NULL OR revoked_at > starts_at)
 *
 * so creating a future grant changes nothing before its start date, and a
 * grant cancelled (or ended by an ownership change) before it ever started
 * never activates enforcement. An immediate grant starts at creation;
 * revoking it later still counts as started.
 */

import { PLANS, PLAN_LABELS, type OperatorPlan } from "@/lib/plans";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GrantPlan = "pro" | "premium";
export type GrantType = "comp" | "trial";
export type GrantEndReason = "revoked" | "ownership_changed" | "venue_cancelled";

export const GRANT_TYPE_LABELS: Record<GrantType, string> = {
  comp:  "Comp",
  trial: "Trial",
};

export type PlanGrant = {
  id: string;
  venueId: string;
  planCode: GrantPlan;
  grantType: GrantType;
  startsAt: string;
  endsAt: string | null;
  reason: string;
  operatorId: string;
  ownerClaimedAt: string | null;
  createdByEmail: string;
  createdAt: string;
  revokedAt: string | null;
  endReason: GrantEndReason | null;
  revokedByEmail: string | null;
  revokeReason: string | null;
};

/** The venue's CURRENT ownership, compared against each grant's snapshot. */
export type VenueOwnership = {
  createdByOperatorId: string | null;
  claimedAt: string | null;
};

export type GrantStatus =
  | "scheduled"
  | "active"
  | "expired"
  | "revoked"
  | "cancelled_before_start"
  | "ended_ownership_changed"
  | "ended_venue_cancelled"
  | "invalidated";

export const GRANT_STATUS_LABELS: Record<GrantStatus, string> = {
  scheduled:               "Scheduled",
  active:                  "Active",
  expired:                 "Expired",
  revoked:                 "Revoked",
  cancelled_before_start:  "Cancelled before start",
  ended_ownership_changed: "Ended — ownership changed",
  ended_venue_cancelled:   "Ended — venue cancelled",
  invalidated:             "Ended — ownership changed",
};

export type AccessSource = "subscription" | "grant" | "free";

export type EffectiveAccess = {
  /** Existing billing entitlement, exactly as the calling surface read it. */
  billingPlan: OperatorPlan;
  /** Higher of billingPlan and the active grant's plan. */
  effectivePlan: OperatorPlan;
  /** "grant" only when an active grant lifts access above the billing plan. */
  source: AccessSource;
  activeGrant: PlanGrant | null;
  /** Open grant whose start date is still in the future, if any. */
  scheduledGrant: PlanGrant | null;
  /** Venue-scoped public content enforcement (see file header). */
  contentEnforced: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Raw DB row coercion (no generated Supabase types in this project)
// ─────────────────────────────────────────────────────────────────────────────

export const PLAN_GRANT_SELECT =
  "id, venue_id, plan_code, grant_type, starts_at, ends_at, reason, operator_id, " +
  "owner_claimed_at, created_by_email, created_at, revoked_at, end_reason, " +
  "revoked_by_email, revoke_reason";

export type PlanGrantDbRow = {
  id: string;
  venue_id: string;
  plan_code: string;
  grant_type: string;
  starts_at: string;
  ends_at: string | null;
  reason: string;
  operator_id: string;
  owner_claimed_at: string | null;
  created_by_email: string;
  created_at: string;
  revoked_at: string | null;
  end_reason: string | null;
  revoked_by_email: string | null;
  revoke_reason: string | null;
};

export function coercePlanGrantRow(row: PlanGrantDbRow): PlanGrant | null {
  if (row.plan_code !== "pro" && row.plan_code !== "premium") return null;
  if (row.grant_type !== "comp" && row.grant_type !== "trial") return null;
  const endReason =
    row.end_reason === "revoked" || row.end_reason === "ownership_changed" || row.end_reason === "venue_cancelled"
      ? row.end_reason
      : null;
  return {
    id:             row.id,
    venueId:        row.venue_id,
    planCode:       row.plan_code,
    grantType:      row.grant_type,
    startsAt:       row.starts_at,
    endsAt:         row.ends_at,
    reason:         row.reason,
    operatorId:     row.operator_id,
    ownerClaimedAt: row.owner_claimed_at,
    createdByEmail: row.created_by_email,
    createdAt:      row.created_at,
    revokedAt:      row.revoked_at,
    endReason,
    revokedByEmail: row.revoked_by_email,
    revokeReason:   row.revoke_reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan ranking
// ─────────────────────────────────────────────────────────────────────────────

export function planRank(plan: OperatorPlan): number {
  return PLANS.indexOf(plan);
}

export function higherPlan(a: OperatorPlan, b: OperatorPlan): OperatorPlan {
  return planRank(b) > planRank(a) ? b : a;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grant state
// ─────────────────────────────────────────────────────────────────────────────

function ms(value: string | null): number | null {
  if (value == null) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * True when the venue is still owned exactly as it was when the grant was
 * created. Read-time fallback to the migration-109 ownership trigger: every
 * re-link rewrites venues.claimed_at, so even an A → B → A ownership round
 * trip leaves the original grant permanently invalid.
 */
export function grantOwnershipMatches(grant: PlanGrant, venue: VenueOwnership): boolean {
  return (
    venue.createdByOperatorId !== null &&
    venue.createdByOperatorId === grant.operatorId &&
    ms(venue.claimedAt) === ms(grant.ownerClaimedAt)
  );
}

/**
 * Whether the grant has ever started (see file header). Drives venue-scoped
 * enforcement. An ownership mismatch with no recorded revocation (the
 * trigger fallback case) is treated as started once its start date passes —
 * the conservative choice, since the exact moment ownership changed is not
 * recorded on the grant.
 */
export function grantHasStarted(grant: PlanGrant, nowMs: number): boolean {
  const starts = ms(grant.startsAt);
  if (starts === null || starts > nowMs) return false;
  const revoked = ms(grant.revokedAt);
  if (revoked !== null && revoked <= starts) return false;
  return true;
}

export function getGrantStatus(grant: PlanGrant, venue: VenueOwnership, nowMs: number): GrantStatus {
  const starts = ms(grant.startsAt) ?? 0;
  const revoked = ms(grant.revokedAt);
  if (revoked !== null) {
    if (revoked <= starts) return "cancelled_before_start";
    if (grant.endReason === "ownership_changed") return "ended_ownership_changed";
    if (grant.endReason === "venue_cancelled") return "ended_venue_cancelled";
    return "revoked";
  }
  if (!grantOwnershipMatches(grant, venue)) return "invalidated";
  if (nowMs < starts) return "scheduled";
  const ends = ms(grant.endsAt);
  if (ends !== null && nowMs >= ends) return "expired";
  return "active";
}

export function isGrantOpen(status: GrantStatus): boolean {
  return status === "scheduled" || status === "active";
}

/** The moment access ended (or will end), for display. Null = open-ended. */
export function grantEffectiveEnd(grant: PlanGrant): string | null {
  const revoked = ms(grant.revokedAt);
  const ends = ms(grant.endsAt);
  if (revoked !== null && (ends === null || revoked < ends)) return grant.revokedAt;
  return grant.endsAt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Effective access
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single resolution point for "what can this venue use". Pure: callers
 * pass the billing plan exactly as their surface already reads it, the
 * venue's grants, its current ownership, and `now`.
 */
export function resolveEffectiveAccess(input: {
  billingPlan: OperatorPlan;
  grants: PlanGrant[];
  venue: VenueOwnership;
  nowMs: number;
}): EffectiveAccess {
  const { billingPlan, grants, venue, nowMs } = input;

  let activeGrant: PlanGrant | null = null;
  let scheduledGrant: PlanGrant | null = null;
  let contentEnforced = false;

  for (const grant of grants) {
    if (grantHasStarted(grant, nowMs)) contentEnforced = true;
    const status = getGrantStatus(grant, venue, nowMs);
    if (status === "active") {
      if (!activeGrant || planRank(grant.planCode) > planRank(activeGrant.planCode)) activeGrant = grant;
    } else if (status === "scheduled") {
      if (!scheduledGrant || (ms(grant.startsAt) ?? 0) < (ms(scheduledGrant.startsAt) ?? 0)) scheduledGrant = grant;
    }
  }

  const grantPlan: OperatorPlan = activeGrant?.planCode ?? "free";
  const effectivePlan = higherPlan(billingPlan, grantPlan);
  const source: AccessSource =
    activeGrant && planRank(grantPlan) > planRank(billingPlan)
      ? "grant"
      : billingPlan !== "free"
      ? "subscription"
      : "free";

  return { billingPlan, effectivePlan, source, activeGrant, scheduledGrant, contentEnforced };
}

/** Free access with no grants — the default for a venue with no data. */
export function noGrantAccess(billingPlan: OperatorPlan): EffectiveAccess {
  return {
    billingPlan,
    effectivePlan: billingPlan,
    source: billingPlan !== "free" ? "subscription" : "free",
    activeGrant: null,
    scheduledGrant: null,
    contentEnforced: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

/** "Premium Comp", "Pro Trial". */
export function grantLabel(grant: Pick<PlanGrant, "planCode" | "grantType">): string {
  return `${PLAN_LABELS[grant.planCode]} ${GRANT_TYPE_LABELS[grant.grantType]}`;
}
