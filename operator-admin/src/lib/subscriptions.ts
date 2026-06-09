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
    console.error(
      "[updateOperatorPlan] operators.plan sync failed (subscription already updated):",
      opError.message
    );
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
      console.error("[syncStripeSubscription] operators.plan sync failed:", opError.message);
    }
  }

  return { ok: true };
}
