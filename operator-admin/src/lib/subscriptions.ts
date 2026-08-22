/**
 * Subscription helpers for Happy Hour Compass.
 *
 * operator_subscriptions is the canonical source of truth for an operator's
 * current plan. operators.plan is a backward-compatibility column that mirrors
 * plan_code and is kept in sync by updateOperatorPlan().
 *
 * All functions here are server-side only — they use the admin client
 * (service-role key) and must never be imported from Client Components.
 *
 * Usage:
 *   import { getOperatorPlanCode, updateOperatorPlan } from "@/lib/subscriptions";
 */

import { createAdminClient } from "@/lib/supabase/server";
import { parseOperatorPlan, type OperatorPlan } from "@/lib/plans";
import { reportCriticalFailure } from "@/lib/observability/reportCriticalFailure";

// ── Observability ────────────────────────────────────────────────────────────
//
// "operator-plan-update" covers updateOperatorPlan()'s two entitlement writes
// (manual admin plan changes, operator-initiated cancellation downgrades —
// never Stripe). "stripe-subscription" reuses the same flow name the Stripe
// webhook route (src/app/api/webhooks/stripe/route.ts) already uses for
// syncStripeSubscription()'s primary-write failures, so both of that
// function's failure modes correlate under one flow.
//
// Both functions share an identical two-write shape (primary subscription
// upsert, then a best-effort operators.plan mirror update for feature-gate
// enforcement — see OPERATOR_SELECT/ctx.operator.plan callers) and,
// previously, an identical blind spot on the second write: it was logged to
// console only, and the function still returned success. That write is the
// field feature-limit enforcement (admin/happy-hours/actions.ts,
// admin/events/actions.ts, admin/venue/imageActions.ts, admin/users/actions.ts)
// actually reads, so a silent failure there is a genuine entitlement-integrity
// gap, not merely cosmetic — see the updateOperatorPlan() investigation report
// for the full evidence trail.
//
// reportCriticalFailure() is called at the point of each failure but the
// return value/control flow of both functions is UNCHANGED by this — this is
// observability-only. updateOperatorPlan()'s write-1 failure still returns
// { ok: false, error }, and both functions' write-2 failure still returns
// { ok: true } — that return-contract problem is a separate, not-yet-scoped
// business-logic fix, not addressed here.
//
// syncStripeSubscription()'s primary-write (subError) failure is already
// instrumented by the Stripe webhook route itself (keyed off its returned
// { ok: false }) — this file does NOT duplicate that. Only its previously-
// unreported operators.plan (opError) failure is instrumented here.
const OPERATOR_PLAN_UPDATE_FLOW = "operator-plan-update";
const STRIPE_SUBSCRIPTION_FLOW = "stripe-subscription";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SubscriptionStatus = "active" | "pending" | "cancelled" | "past_due";
export type BillingProvider    = "manual" | "stripe";

export type SubscriptionRow = {
  id:                                string;
  operator_id:                       string;
  plan_code:                         OperatorPlan;
  status:                            SubscriptionStatus;
  billing_provider:                  BillingProvider;
  billing_provider_customer_id:      string | null;
  billing_provider_subscription_id:  string | null;
  current_period_start:              string | null;
  current_period_end:                string | null;
  created_at:                        string;
  updated_at:                        string;
};

const SUBSCRIPTION_SELECT =
  "id, operator_id, plan_code, status, billing_provider, " +
  "billing_provider_customer_id, billing_provider_subscription_id, " +
  "current_period_start, current_period_end, created_at, updated_at";

// Raw shape returned by Supabase before our type coercions.
// Needed because there are no generated Supabase types in this project —
// the untyped client infers GenericStringError for unknown tables, which
// blocks property access. Pattern matches ensureOperator.ts / venueNotes.ts.
type SubscriptionDbRow = {
  id: string;
  operator_id: string;
  plan_code: string | null;
  status: string | null;
  billing_provider: string | null;
  billing_provider_customer_id: string | null;
  billing_provider_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
};


// ─────────────────────────────────────────────────────────────────────────────
// Read helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the subscription row for an operator, or null if none exists.
 * Uses the admin client — RLS blocks non-service-role reads.
 */
export async function getOperatorSubscription(
  operatorId: string
): Promise<SubscriptionRow | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("operator_subscriptions")
    .select(SUBSCRIPTION_SELECT)
    .eq("operator_id", operatorId)
    .maybeSingle();

  if (error) {
    console.error("[getOperatorSubscription]", error.message);
    return null;
  }

  if (!data) return null;

  const row = data as unknown as SubscriptionDbRow;

  return {
    id:                               row.id,
    operator_id:                      row.operator_id,
    plan_code:                        parseOperatorPlan(row.plan_code),
    status:                           (row.status ?? "active") as SubscriptionStatus,
    billing_provider:                 (row.billing_provider ?? "manual") as BillingProvider,
    billing_provider_customer_id:     row.billing_provider_customer_id,
    billing_provider_subscription_id: row.billing_provider_subscription_id,
    current_period_start:             row.current_period_start,
    current_period_end:               row.current_period_end,
    created_at:                       row.created_at,
    updated_at:                       row.updated_at,
  };
}

/**
 * Returns the current plan code for an operator.
 *
 * Fallback chain (most to least authoritative):
 *   1. operator_subscriptions.plan_code  — new source of truth
 *   2. operators.plan                    — backward-compat column
 *   3. 'free'                            — safe default
 */
export async function getOperatorPlanCode(operatorId: string): Promise<OperatorPlan> {
  const subscription = await getOperatorSubscription(operatorId);
  if (subscription) return subscription.plan_code;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("operators")
    .select("plan")
    .eq("id", operatorId)
    .maybeSingle();

  return parseOperatorPlan((data as { plan?: unknown } | null)?.plan);
}


// ─────────────────────────────────────────────────────────────────────────────
// Write helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manually changes an operator's plan.
 *
 * Updates both operator_subscriptions.plan_code (new source of truth) and
 * operators.plan (backward-compat column) so all existing feature gates
 * continue to work without modification.
 *
 * Supported transitions:
 *   free ↔ pro ↔ premium ↔ enterprise (any direction)
 *
 * Does NOT:
 *   - Touch Stripe or billing fields.
 *   - Trim or delete over-limit content (downgrade protection in server
 *     actions handles that at point-of-save).
 *   - Validate that the caller is authorized — callers are responsible for
 *     ensuring only Control Panel admins invoke this function.
 */
export async function updateOperatorPlan(
  operatorId: string,
  newPlan: OperatorPlan
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminClient();

  // Upsert the subscription row: creates it if missing, updates plan_code if present.
  // onConflict targets the UNIQUE (operator_id) constraint from migration 036.
  const { error: subError } = await supabase
    .from("operator_subscriptions")
    .upsert(
      {
        operator_id:      operatorId,
        plan_code:        newPlan,
        status:           "active",
        billing_provider: "manual",
      },
      { onConflict: "operator_id" }
    );

  if (subError) {
    console.error("[updateOperatorPlan] subscription upsert failed:", subError.message);
    await reportCriticalFailure({
      error: new Error(subError.message),
      flow: OPERATOR_PLAN_UPDATE_FLOW,
      stage: "subscription-upsert",
      title: "Operator Plan Update Failed",
      technicalSummary: "database write failed (operator_subscriptions upsert)",
      context: { operatorId, targetPlan: newPlan },
      slackFields: { "Operator ID": operatorId, "Target Plan": newPlan },
    });
    return { ok: false, error: subError.message };
  }

  // Keep operators.plan in sync for all existing feature gates.
  const { error: opError } = await supabase
    .from("operators")
    .update({ plan: newPlan })
    .eq("id", operatorId);

  if (opError) {
    // Subscription is the source of truth and was already updated successfully.
    // Log the sync failure but don't surface it as an error to the caller —
    // the next full page load will still read the correct plan from the subscription.
    //
    // That return-value behavior is unchanged here (observability-only — see
    // the file-header comment); operators.plan is what feature-gate
    // enforcement actually reads, so this failure is reported critical even
    // though the function still reports { ok: true } to its caller.
    console.error(
      "[updateOperatorPlan] operators.plan sync failed (subscription already updated):",
      opError.message
    );
    await reportCriticalFailure({
      error: new Error(opError.message),
      flow: OPERATOR_PLAN_UPDATE_FLOW,
      stage: "operators-plan-sync",
      title: "Operator Plan Update Failed",
      technicalSummary: "database write failed (operators.plan sync — enforcement mirror stale)",
      context: { operatorId, targetPlan: newPlan },
      slackFields: { "Operator ID": operatorId, "Target Plan": newPlan },
    });
  }

  return { ok: true };
}


// ─────────────────────────────────────────────────────────────────────────────
// Stripe sync
// ─────────────────────────────────────────────────────────────────────────────

export type StripeSync = {
  customerId:     string;
  subscriptionId: string;
  planCode?:      string;  // omit to leave plan_code unchanged
  status:         SubscriptionStatus;
  periodStart:    string | null;
  periodEnd:      string | null;
};

/**
 * Upserts operator_subscriptions from a Stripe webhook event.
 *
 * Always sets billing_provider = 'stripe' and updates billing IDs.
 * When planCode is provided, also syncs operators.plan for feature gating.
 * Upserts rather than updates to handle first-checkout races safely.
 */
export async function syncStripeSubscription(
  operatorId: string,
  sync: StripeSync
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminClient();

  const patch: Record<string, unknown> = {
    billing_provider:                 "stripe",
    billing_provider_customer_id:     sync.customerId,
    billing_provider_subscription_id: sync.subscriptionId,
    status:                           sync.status,
    current_period_start:             sync.periodStart,
    current_period_end:               sync.periodEnd,
    updated_at:                       new Date().toISOString(),
  };

  if (sync.planCode !== undefined) {
    patch.plan_code = parseOperatorPlan(sync.planCode);
  }

  const { error: subError } = await supabase
    .from("operator_subscriptions")
    .upsert(
      { operator_id: operatorId, ...patch },
      { onConflict: "operator_id" }
    );

  if (subError) {
    console.error("[syncStripeSubscription] upsert failed:", subError.message);
    return { ok: false, error: subError.message };
  }

  if (sync.planCode !== undefined) {
    const plan = parseOperatorPlan(sync.planCode);
    const { error: opError } = await supabase
      .from("operators")
      .update({ plan })
      .eq("id", operatorId);

    if (opError) {
      // Subscription is already updated — log but don't surface as an error.
      //
      // Return-value behavior is unchanged here (observability-only). The
      // Stripe webhook route already instruments this function's primary
      // (subError) failure via its own returned { ok: false } — this is the
      // previously-unreported parallel gap: operators.plan is what
      // feature-gate enforcement actually reads, so a stale mirror here is
      // the same entitlement-integrity failure as updateOperatorPlan()'s
      // operators-plan-sync stage, just reached from the Stripe path instead
      // of a manual admin/cancellation path.
      console.error("[syncStripeSubscription] operators.plan sync failed:", opError.message);
      await reportCriticalFailure({
        error: new Error(opError.message),
        flow: STRIPE_SUBSCRIPTION_FLOW,
        stage: "operators-plan-sync",
        title: "Stripe Subscription Plan Sync Failed",
        technicalSummary: "database write failed (operators.plan sync — enforcement mirror stale)",
        context: { operatorId, targetPlan: plan, stripeSubscriptionId: sync.subscriptionId, stripeCustomerId: sync.customerId },
        slackFields: { "Operator ID": operatorId, "Target Plan": plan, Subscription: sync.subscriptionId },
      });
    }
  }

  return { ok: true };
}
