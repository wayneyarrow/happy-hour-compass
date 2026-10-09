/**
 * Comp / Trial plan grants — server-side reads.
 *
 * Server-only (admin client). Never imported by Stripe code: billing stays
 * entirely in src/lib/venueSubscriptions.ts + the Stripe webhook/actions,
 * which are unchanged by grants (pinned by tests/unit/planGrants/
 * planGrantsWiring.test.ts).
 *
 * READ FAILURES ARE NEVER "NO GRANTS". Each read distinguishes a successful
 * lookup that found nothing from a failed lookup:
 *   - getVenuePlanGrants() → null on failure (Control Panel shows an error
 *     instead of an empty grant list / a create form);
 *   - getPlanGrantsForVenues() / getEffectiveAccessForVenues() → ok: false
 *     (callers flag their report as incomplete);
 *   - entitlement resolution on failure falls back to the BILLING plan only
 *     — i.e. a grant can be temporarily lost, never wrongly gained.
 * Public pages don't use this module: they embed grants in the content query
 * itself (src/lib/planGrants/publicPlanState.ts), so a failed grant read
 * there is a failed content read.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { parseOperatorPlan, type OperatorPlan } from "@/lib/plans";
import { getVenueSubscription, resolvePlanCodeFromVenueSubscription, highestPlan } from "@/lib/venueSubscriptions";
import {
  coercePlanGrantRow,
  noGrantAccess,
  resolveEffectiveAccess,
  PLAN_GRANT_SELECT,
  type EffectiveAccess,
  type PlanGrant,
  type PlanGrantDbRow,
  type VenueOwnership,
} from "@/lib/planGrants/grantState";
import {
  countRawSpecials,
  enforcedPolicy,
  summarizePausedContent,
  UNRESTRICTED_POLICY,
  type ContentCounts,
  type PausedContentSummary,
  type PublicContentPolicy,
} from "@/lib/planGrants/contentPolicy";

type AdminClient = ReturnType<typeof createAdminClient>;

function coerceRows(rows: unknown[] | null): PlanGrant[] {
  return ((rows ?? []) as PlanGrantDbRow[])
    .map(coercePlanGrantRow)
    .filter((g): g is PlanGrant => g !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Single venue
// ─────────────────────────────────────────────────────────────────────────────

/** A venue's grants, newest first. Null = the lookup FAILED (not "no grants"). */
export async function getVenuePlanGrants(venueId: string, admin: AdminClient = createAdminClient()): Promise<PlanGrant[] | null> {
  const { data, error } = await admin
    .from("venue_plan_grants")
    .select(PLAN_GRANT_SELECT)
    .eq("venue_id", venueId)
    .order("starts_at", { ascending: false });
  if (error) {
    console.error("[getVenuePlanGrants]", error.message);
    return null;
  }
  return coerceRows(data);
}

async function getVenueOwnership(venueId: string, admin: AdminClient): Promise<VenueOwnership> {
  const { data, error } = await admin
    .from("venues")
    .select("created_by_operator_id, claimed_at")
    .eq("id", venueId)
    .maybeSingle();
  if (error || !data) return { createdByOperatorId: null, claimedAt: null };
  const row = data as { created_by_operator_id: string | null; claimed_at: string | null };
  return { createdByOperatorId: row.created_by_operator_id, claimedAt: row.claimed_at };
}

/**
 * Effective access for one venue. `billingPlan` defaults to the venue's
 * existing billing resolution (getVenueSubscription() →
 * resolvePlanCodeFromVenueSubscription(), exactly what every Operator Admin
 * gate read before grants existed).
 */
export async function getVenueEffectiveAccess(
  venueId: string,
  options?: { billingPlan?: OperatorPlan; nowMs?: number }
): Promise<EffectiveAccess> {
  const admin = createAdminClient();
  const billingPromise: Promise<OperatorPlan> =
    options?.billingPlan !== undefined
      ? Promise.resolve(options.billingPlan)
      : getVenueSubscription(venueId).then(resolvePlanCodeFromVenueSubscription);

  const [billingPlan, grants] = await Promise.all([billingPromise, getVenuePlanGrants(venueId, admin)]);
  // Failed lookup → billing entitlement only (a grant is temporarily not
  // applied; access is never wrongly granted).
  if (grants === null || grants.length === 0) return noGrantAccess(billingPlan);

  const venue = await getVenueOwnership(venueId, admin);
  return resolveEffectiveAccess({ billingPlan, grants, venue, nowMs: options?.nowMs ?? Date.now() });
}

/** Effective plan for one venue — the entitlement every Operator Admin gate checks. */
export async function getVenueEffectivePlan(venueId: string): Promise<OperatorPlan> {
  return (await getVenueEffectiveAccess(venueId)).effectivePlan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batched (Control Panel lists — funnel, Action Center, operators)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Grants + current ownership for many venues in two queries. Venues with no
 * grants are absent from the returned map.
 */
export async function getPlanGrantsForVenues(
  venueIds: string[],
  admin: AdminClient = createAdminClient()
): Promise<{ ok: boolean; grantsByVenue: Map<string, PlanGrant[]>; ownershipByVenue: Map<string, VenueOwnership> }> {
  const grantsByVenue = new Map<string, PlanGrant[]>();
  const ownershipByVenue = new Map<string, VenueOwnership>();
  if (venueIds.length === 0) return { ok: true, grantsByVenue, ownershipByVenue };

  const { data, error } = await admin
    .from("venue_plan_grants")
    .select(`${PLAN_GRANT_SELECT}, venues!venue_plan_grants_venue_id_fkey!inner(created_by_operator_id, claimed_at)`)
    .in("venue_id", venueIds);
  if (error) {
    console.error("[getPlanGrantsForVenues]", error.message);
    return { ok: false, grantsByVenue, ownershipByVenue };
  }

  for (const row of (data ?? []) as Array<PlanGrantDbRow & { venues: unknown }>) {
    const grant = coercePlanGrantRow(row);
    if (!grant) continue;
    const list = grantsByVenue.get(grant.venueId) ?? [];
    list.push(grant);
    grantsByVenue.set(grant.venueId, list);
    const v = (Array.isArray(row.venues) ? row.venues[0] : row.venues) as
      | { created_by_operator_id: string | null; claimed_at: string | null }
      | null;
    if (v) ownershipByVenue.set(grant.venueId, { createdByOperatorId: v.created_by_operator_id, claimedAt: v.claimed_at });
  }
  return { ok: true, grantsByVenue, ownershipByVenue };
}

/**
 * Effective access for many venues given each venue's billing plan as the
 * calling surface already resolved it (e.g. buildVenuePlanMap()). Venues
 * absent from `byVenue` have no grants — callers use noGrantAccess().
 * `ok: false` = the grant lookup failed: every venue resolves to its billing
 * plan only, and callers must surface that their data is incomplete.
 */
export async function getEffectiveAccessForVenues(
  billingPlanByVenue: Map<string, OperatorPlan>,
  venueIds: string[],
  nowMs: number = Date.now()
): Promise<{ ok: boolean; byVenue: Map<string, EffectiveAccess> }> {
  const { ok, grantsByVenue, ownershipByVenue } = await getPlanGrantsForVenues(venueIds);
  const out = new Map<string, EffectiveAccess>();
  for (const [venueId, grants] of grantsByVenue) {
    out.set(
      venueId,
      resolveEffectiveAccess({
        billingPlan: billingPlanByVenue.get(venueId) ?? "free",
        grants,
        venue: ownershipByVenue.get(venueId) ?? { createdByOperatorId: null, claimedAt: null },
        nowMs,
      })
    );
  }
  return { ok, byVenue: out };
}

/**
 * Team-seat plan: highest EFFECTIVE plan across the operator's manageable
 * (non-cancelled) venues — the grant-aware counterpart of
 * getOperatorHighestVenuePlan() (src/lib/venueSubscriptions.ts), which stays
 * unchanged for billing purposes.
 */
export async function getOperatorHighestEffectivePlan(operatorId: string): Promise<OperatorPlan> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("venues")
    .select("id")
    .eq("created_by_operator_id", operatorId)
    .is("cancelled_at", null);
  if (error) {
    console.error("[getOperatorHighestEffectivePlan]", error.message);
    return "free";
  }
  const venueIds = ((data ?? []) as { id: string }[]).map((v) => v.id);
  if (venueIds.length === 0) return "free";

  const { data: subs } = await admin
    .from("venue_subscriptions")
    .select("venue_id, plan_code")
    .in("venue_id", venueIds);
  const billing = new Map<string, OperatorPlan>(
    ((subs ?? []) as { venue_id: string; plan_code: string | null }[]).map((r) => [r.venue_id, parseOperatorPlan(r.plan_code)])
  );
  const { byVenue: access } = await getEffectiveAccessForVenues(billing, venueIds);
  return highestPlan(venueIds.map((id) => access.get(id)?.effectivePlan ?? billing.get(id) ?? "free"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator visibility — paused content for the active venue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How much of a grant recipient's stored, published content is currently
 * paused publicly (outside its effective plan). All zeros — and no queries —
 * for venues without content enforcement.
 */
export async function getVenuePausedContent(venueId: string, access: EffectiveAccess): Promise<PausedContentSummary> {
  const policy: PublicContentPolicy = access.contentEnforced ? enforcedPolicy(access.effectivePlan) : UNRESTRICTED_POLICY;
  if (!policy.enforced) return summarizePausedContent(policy, EMPTY_COUNTS);

  const admin = createAdminClient();
  const [venueRes, eventsRes, specialsRes, mediaRes] = await Promise.all([
    admin.from("venues").select("hh_food_details, hh_drink_details, search_tags").eq("id", venueId).maybeSingle(),
    admin.from("events").select("recurrence, is_seeded_event").eq("venue_id", venueId).eq("is_published", true),
    admin.from("daily_specials").select("schedule_type, is_seeded_special").eq("venue_id", venueId).eq("is_published", true),
    admin.from("media").select("id", { count: "exact", head: true }).eq("venue_id", venueId).eq("type", "venue_image"),
  ]);

  const v = (venueRes.data ?? {}) as { hh_food_details?: string | null; hh_drink_details?: string | null; search_tags?: string[] | null };
  const events = (eventsRes.data ?? []) as { recurrence: string | null; is_seeded_event: boolean | null }[];
  const specials = (specialsRes.data ?? []) as { schedule_type: string | null; is_seeded_special: boolean | null }[];
  const recurring = events.filter((e) => e.recurrence && e.recurrence !== "none");
  const weekly = specials.filter((s) => s.schedule_type === "weekly");

  return summarizePausedContent(policy, {
    recurringEvents:       recurring.length,
    seededRecurringEvents: recurring.filter((e) => e.is_seeded_event === true).length,
    weeklySpecials:        weekly.length,
    seededWeeklySpecials:  weekly.filter((s) => s.is_seeded_special === true).length,
    foodSpecials:          countRawSpecials(v.hh_food_details ?? null),
    drinkSpecials:         countRawSpecials(v.hh_drink_details ?? null),
    images:                mediaRes.count ?? 0,
    searchTags:            Array.isArray(v.search_tags) ? v.search_tags.length : 0,
  });
}

const EMPTY_COUNTS: ContentCounts = {
  recurringEvents: 0,
  seededRecurringEvents: 0,
  weeklySpecials: 0,
  seededWeeklySpecials: 0,
  foodSpecials: 0,
  drinkSpecials: 0,
  images: 0,
  searchTags: 0,
};
