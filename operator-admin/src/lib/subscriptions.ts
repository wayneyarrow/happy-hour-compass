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

// ── Atomicity ────────────────────────────────────────────────────────────────
//
// Both updateOperatorPlan() and syncStripeSubscription() (for a PLAN-CHANGING
// sync — sync.planCode !== undefined) write through the
// sync_operator_plan_entitlement() Postgres RPC (migration
// 081_operator_plan_entitlement_atomic_sync.sql) rather than performing two
// sequential, independent writes. That RPC atomically upserts
// operator_subscriptions and updates operators.plan (and, for the Stripe
// case, every Stripe-specific subscription field — billing provider,
// customer/subscription IDs, status, period dates — together with
// operators.plan) in a single Postgres function call: it commits or rolls
// back as one unit, so it is no longer possible for operator_subscriptions
// and operators.plan to diverge from a plan-changing write. See the
// migration's own header for the full design rationale and the
// operator-plan-entitlement investigation report for the evidence that
// motivated this — operators.plan is documented as a backward-compatibility
// cache column, but several real feature-limit enforcement server actions
// (admin/happy-hours/actions.ts, admin/events/actions.ts,
// admin/venue/imageActions.ts, admin/users/actions.ts) read it directly, so a
// divergence there was a genuine entitlement-integrity bug, not cosmetic.
//
// Stripe STATUS/PERIOD-ONLY syncs (sync.planCode === undefined — e.g.
// invoice.payment_succeeded) do NOT go through the RPC and are unchanged:
// they never touched operators.plan before and still don't; a single-table
// operator_subscriptions upsert was already atomic on its own.
//
// ── Observability ownership ─────────────────────────────────────────────────
//
// updateOperatorPlan() has no other caller-side reporting for its own
// failures (changePlanAction/cancelVenueAction never instrumented this
// themselves), so it keeps owning and reporting its own single failure mode
// here, consolidated into ONE stage ("entitlement-write") now that there is
// only one write to fail, replacing the previous two stages
// (subscription-upsert / operators-plan-sync) from before atomicity.
//
// syncStripeSubscription()'s plan-changing branch does NOT call
// reportCriticalFailure() itself. Before this migration, its
// operators.plan-only failure was the one previously-unreported gap this
// file instrumented directly — but now that write is part of the SAME atomic
// RPC call as the primary operator_subscriptions write, which the Stripe
// webhook route (src/app/api/webhooks/stripe/route.ts) has already owned and
// reported (with richer, per-branch severity and Stripe-event context this
// function has no visibility into — e.g. event.id) since the earlier Stripe
// observability task. There is now only ONE failure mode for a plan-changing
// Stripe sync, and the webhook route's existing `if (!result.ok)` checks
// already cover it completely — no change to that file was needed or made.
// Reporting inside syncStripeSubscription() as well would double-report the
// same RPC failure. STRIPE_SUBSCRIPTION_FLOW is therefore no longer
// referenced in this file — the flow name that stage will show up under
// (still "stripe-subscription") lives entirely in route.ts, unchanged.
const OPERATOR_PLAN_UPDATE_FLOW = "operator-plan-update";

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
 * Atomically updates both operator_subscriptions.plan_code (canonical
 * source of truth) and operators.plan (read directly by several real
 * feature-gate enforcement server actions — see this file's Atomicity
 * comment above) via the sync_operator_plan_entitlement() RPC (migration
 * 081). The two writes now commit or roll back together — it is no longer
 * possible for this function to return { ok: true } while the two
 * representations diverge.
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
): Promise<{ ok: boolean; error?: string; hhcErrorId?: string }> {
  const supabase = createAdminClient();

  const { error } = await supabase.rpc("sync_operator_plan_entitlement", {
    p_operator_id:      operatorId,
    p_plan_code:        newPlan,
    p_status:           "active",
    p_billing_provider: "manual",
  });

  if (error) {
    console.error("[updateOperatorPlan] atomic entitlement sync failed:", error.message);
    const report = await reportCriticalFailure({
      error: new Error(error.message),
      flow: OPERATOR_PLAN_UPDATE_FLOW,
      stage: "entitlement-write",
      title: "Operator Plan Update Failed",
      technicalSummary: "atomic database write failed (operator_subscriptions + operators.plan)",
      context: { operatorId, targetPlan: newPlan },
      slackFields: { "Operator ID": operatorId, "Target Plan": newPlan },
    });
    return { ok: false, error: error.message, hhcErrorId: report.hhcErrorId };
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
 * Syncs operator_subscriptions (and, when a plan change is present,
 * operators.plan) from a Stripe webhook event.
 *
 * Two distinct paths:
 *
 *   PLAN-CHANGING sync (sync.planCode !== undefined — checkout activation,
 *   a subscription-updated event carrying a price change, or a
 *   subscription-deleted downgrade to free): writes through the
 *   sync_operator_plan_entitlement() RPC (migration 081), atomically. ALL
 *   Stripe-specific subscription fields (billing_provider, customer/
 *   subscription IDs, status, period dates) commit or roll back together
 *   with plan_code and operators.plan — it is no longer possible for this
 *   sync to partially commit Stripe subscription state while the
 *   entitlement write fails, or vice versa. On failure, this function
 *   returns { ok: false, error } exactly as before — it does NOT call
 *   reportCriticalFailure() itself; that failure is already owned and
 *   reported by the Stripe webhook route (src/app/api/webhooks/stripe/
 *   route.ts), which has richer per-branch severity and Stripe-event
 *   context this function doesn't have visibility into. See this file's
 *   Atomicity/Observability ownership comment above for the full reasoning.
 *
 *   STATUS/PERIOD-ONLY sync (sync.planCode === undefined — e.g.
 *   invoice.payment_succeeded, a renewal): unchanged from before this
 *   migration — a single-table operator_subscriptions upsert, never
 *   touching operators.plan. Already atomic on its own (one statement).
 *
 * Upserts (rather than updates) operator_subscriptions in both paths to
 * handle first-checkout races safely.
 */
export async function syncStripeSubscription(
  operatorId: string,
  sync: StripeSync
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminClient();

  if (sync.planCode !== undefined) {
    const plan = parseOperatorPlan(sync.planCode);
    const { error } = await supabase.rpc("sync_operator_plan_entitlement", {
      p_operator_id:                      operatorId,
      p_plan_code:                        plan,
      p_status:                           sync.status,
      p_billing_provider:                 "stripe",
      p_billing_provider_customer_id:     sync.customerId,
      p_billing_provider_subscription_id: sync.subscriptionId,
      p_current_period_start:             sync.periodStart,
      p_current_period_end:               sync.periodEnd,
    });

    if (error) {
      // Deliberately no reportCriticalFailure() call here — see the
      // Observability ownership comment above. The webhook route's existing
      // `if (!result.ok)` branches already own and report this.
      console.error("[syncStripeSubscription] atomic entitlement sync failed:", error.message);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  }

  // Status/period-only sync — never touches operators.plan.
  const { error: subError } = await supabase
    .from("operator_subscriptions")
    .upsert(
      {
        operator_id:                       operatorId,
        billing_provider:                  "stripe",
        billing_provider_customer_id:      sync.customerId,
        billing_provider_subscription_id:  sync.subscriptionId,
        status:                            sync.status,
        current_period_start:              sync.periodStart,
        current_period_end:                sync.periodEnd,
        updated_at:                        new Date().toISOString(),
      },
      { onConflict: "operator_id" }
    );

  if (subError) {
    console.error("[syncStripeSubscription] upsert failed:", subError.message);
    return { ok: false, error: subError.message };
  }

  return { ok: true };
}
