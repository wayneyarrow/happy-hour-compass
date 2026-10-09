/**
 * Public plan context for one venue row — pure, used by every public reader
 * (venues.ts, events.ts, dailySpecials.ts).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY GRANTS ARE EMBEDDED IN THE CONTENT QUERY (not a separate lookup)
 * ─────────────────────────────────────────────────────────────────────────
 * Public readers embed each venue's grants, billing plan and ownership
 * (VENUE_PLAN_CONTEXT_EMBED) directly in the SAME PostgREST query that
 * returns the content. So:
 *   - "lookup succeeded, venue has no grants" is an empty embedded array —
 *     the venue is mapped exactly as before (no limits);
 *   - "lookup failed" is the content query itself failing — the reader
 *     takes its existing error path (empty list / null), never a silent
 *     "no grants, show everything";
 *   - a row whose grant embed is missing (a query that forgot the embed, or
 *     an unexpected response shape) throws PlanContextUnavailableError,
 *     which every reader's existing try/catch turns into that same error
 *     path. Entitlement can't be bypassed by a partial read.
 * No extra round trip, and no way for a grant recipient's paused content to
 * reappear because one auxiliary query failed while the content query
 * succeeded.
 *
 * DEPLOY ORDER: migration 109 must be applied before code using this embed
 * deploys — PostgREST rejects an embed of a relation that doesn't exist.
 */

import { parseOperatorPlan, type OperatorPlan } from "@/lib/plans";
import {
  coercePlanGrantRow,
  higherPlan,
  PLAN_GRANT_SELECT,
  resolveEffectiveAccess,
  type EffectiveAccess,
  type PlanGrant,
  type PlanGrantDbRow,
} from "@/lib/planGrants/grantState";
import { UNRESTRICTED_POLICY, enforcedPolicy, type PublicContentPolicy } from "@/lib/planGrants/contentPolicy";

/**
 * Everything resolveVenuePlanContext() needs from a venue row. Append it to
 * any `venues` select — top-level or inside a `venues(...)` embed. Every
 * field is aliased (plan_ctx_*) so it never collides with, duplicates, or
 * changes the meaning of columns/embeds a reader already selects (e.g. a
 * list query that deliberately doesn't expose claimed_at).
 */
export const VENUE_PLAN_CONTEXT_EMBED =
  "plan_ctx_operator_id:created_by_operator_id, " +
  "plan_ctx_claimed_at:claimed_at, " +
  "plan_ctx_subscription:venue_subscriptions(plan_code), " +
  // Explicit FK hint: venue_plan_grant_events references both venues and
  // venue_plan_grants, so PostgREST would otherwise also see a many-to-many
  // path and reject the embed as ambiguous (PGRST201).
  `plan_ctx_grants:venue_plan_grants!venue_plan_grants_venue_id_fkey(${PLAN_GRANT_SELECT})`;

/** Thrown when a row lacks the grant embed — readers treat it as a failed read. */
export class PlanContextUnavailableError extends Error {
  constructor(detail: string) {
    super(`Public plan context unavailable: ${detail}`);
    this.name = "PlanContextUnavailableError";
  }
}

export type VenuePlanContext = {
  /** Content policy (unrestricted unless the venue is a grant recipient). */
  policy: PublicContentPolicy;
  /** Plan for public ranking (Discover / featured events plan lift). */
  rankingPlan: OperatorPlan;
};

export const UNRESTRICTED_CONTEXT = (rankingPlan: OperatorPlan = "free"): VenuePlanContext => ({
  policy: UNRESTRICTED_POLICY,
  rankingPlan,
});

function firstEmbedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Resolves a venue's public plan context from a row that embedded
 * VENUE_PLAN_CONTEXT_EMBED (or the equivalent fields).
 *
 * `venue` null/undefined (an event/special with no venue row) → unrestricted:
 * grants only exist on venues. A venue row WITHOUT the grant/billing embeds
 * throws — never silently unrestricted.
 */
export function resolveVenuePlanContext(
  venue: Record<string, unknown> | null | undefined,
  nowMs: number
): VenuePlanContext {
  if (venue == null) return UNRESTRICTED_CONTEXT();
  if (!Array.isArray(venue.plan_ctx_grants)) {
    throw new PlanContextUnavailableError("venue row has no plan_ctx_grants embed");
  }
  if (!("plan_ctx_subscription" in venue)) {
    throw new PlanContextUnavailableError("venue row has no plan_ctx_subscription embed");
  }
  if (!("plan_ctx_operator_id" in venue) || !("plan_ctx_claimed_at" in venue)) {
    throw new PlanContextUnavailableError("venue row has no plan_ctx ownership fields");
  }

  const billingPlan = parseOperatorPlan(
    firstEmbedded(venue.plan_ctx_subscription as { plan_code?: unknown } | { plan_code?: unknown }[] | null)?.plan_code
  );
  const rows = venue.plan_ctx_grants as PlanGrantDbRow[];
  if (rows.length === 0) return UNRESTRICTED_CONTEXT(billingPlan);

  const grants = rows.map(coercePlanGrantRow).filter((g): g is PlanGrant => g !== null);
  const access = resolveEffectiveAccess({
    billingPlan,
    grants,
    venue: {
      createdByOperatorId: (venue.plan_ctx_operator_id as string | null) ?? null,
      claimedAt: (venue.plan_ctx_claimed_at as string | null) ?? null,
    },
    nowMs,
  });
  return {
    policy: access.contentEnforced ? enforcedPolicy(access.effectivePlan) : UNRESTRICTED_POLICY,
    rankingPlan: higherPlan(billingPlan, access.effectivePlan),
  };
}

/**
 * Public content policy for one venue from its EffectiveAccess — used by
 * Operator Admin pages to mark exactly which stored items are paused
 * publicly (same rules the public readers apply).
 */
export function policyFromAccess(access: EffectiveAccess): PublicContentPolicy {
  return access.contentEnforced ? enforcedPolicy(access.effectivePlan) : UNRESTRICTED_POLICY;
}
