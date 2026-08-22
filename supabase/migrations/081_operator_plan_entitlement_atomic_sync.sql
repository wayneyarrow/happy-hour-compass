-- =============================================================================
-- Happy Hour Compass — Atomic Operator Plan Entitlement Sync
-- Migration: 081_operator_plan_entitlement_atomic_sync.sql
--
-- PURPOSE:
--   Closes a confirmed partial-success / false-success gap in operator plan
--   entitlement writes. Both updateOperatorPlan() and syncStripeSubscription()
--   (operator-admin/src/lib/subscriptions.ts) previously performed two
--   sequential, independent writes for any plan-changing operation:
--
--     1. operator_subscriptions upsert (documented canonical source of truth
--        — see migration 036's header)
--     2. operators.plan update (documented as a backward-compatibility cache
--        column, but in practice the column several real feature-limit
--        enforcement server actions read directly — admin/happy-hours/actions.ts,
--        admin/events/actions.ts, admin/venue/imageActions.ts,
--        admin/users/actions.ts)
--
--   If write 1 succeeded and write 2 failed, both functions could previously
--   still report { ok: true } to their callers while the database held
--   divergent entitlement state (operator_subscriptions.plan_code = new plan,
--   operators.plan = old plan) — confirmed via a dedicated investigation
--   (see the operator-plan-entitlement investigation report for full evidence).
--
-- DESIGN:
--   One SECURITY DEFINER function, sync_operator_plan_entitlement(), performs
--   the operator_subscriptions upsert AND the operators.plan update inside a
--   single Postgres function invocation — which is atomic by default (no
--   explicit BEGIN/COMMIT needed; if either statement raises, the whole call
--   rolls back). This closes the partial-commit window entirely for any
--   PLAN-CHANGING write, whether manual (updateOperatorPlan) or Stripe-driven
--   (syncStripeSubscription when sync.planCode is present).
--
--   Parameterized generically enough to serve both callers with the same
--   function: manual changes call it with just operator_id + plan_code
--   (accepting the DEFAULT 'active'/'manual' status/billing_provider);
--   Stripe plan-changing syncs pass the full Stripe-specific patch (billing
--   provider, customer/subscription IDs, status, period dates) alongside
--   plan_code, so ALL of that Stripe-specific subscription state commits or
--   rolls back together with operators.plan — the exact atomic boundary this
--   migration exists to establish for a plan-changing Stripe sync (not just
--   the two plan-code columns considered in isolation).
--
--   Stripe STATUS/PERIOD-ONLY syncs (sync.planCode === undefined — e.g.
--   invoice.payment_succeeded, a renewal with no plan change) deliberately do
--   NOT call this function and are NOT changed by this migration at all —
--   they never touched operators.plan before and still don't; they remain a
--   single-table operator_subscriptions upsert, which was already atomic on
--   its own (a single SQL statement cannot partially commit).
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--   - Does not touch plan_change_events, audit_logs, venue_notes, or any
--     notification/email/Slack side effect — those remain application-layer,
--     best-effort, and strictly downstream of a confirmed entitlement commit.
--   - Does not change plan definitions, pricing, Stripe price IDs, or feature
--     limits.
--   - Does not narrow operator_subscriptions_plan_code_check (still allows
--     free | pro | premium | enterprise, from migration 036) — validation is
--     intentionally left to that existing CHECK constraint rather than
--     duplicated here, so an invalid plan_code still fails exactly as it
--     always has, just now inside the atomic function instead of the
--     original upsert.
--   - Does not change any RLS policy or expand access beyond service_role —
--     matches the access model already in effect (every current caller uses
--     createAdminClient(), which is service-role and bypasses RLS).
--
-- PRECEDENT:
--   Follows the exact SECURITY DEFINER RPC pattern already established by
--   enqueue_brevo_contact_sync() / claim_brevo_outbox_batch()
--   (migration 075_brevo_sync_outbox.sql) — same LANGUAGE plpgsql,
--   SECURITY DEFINER, SET search_path = public, GRANT EXECUTE ... TO
--   service_role shape.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: sync_operator_plan_entitlement
--
-- Atomically upserts operator_subscriptions and updates operators.plan to
-- match, in one Postgres transaction. Used for every PLAN-CHANGING write
-- (manual admin/founder changes, operator-initiated cancellation downgrades,
-- and Stripe syncs that carry a plan change) — never for Stripe status/
-- period-only syncs, which continue to write operator_subscriptions alone.
--
-- Raises (and therefore rolls back both statements) if:
--   - p_plan_code violates operator_subscriptions_plan_code_check
--     (existing constraint from migration 036 — free | pro | premium |
--     enterprise only; unchanged by this migration)
--   - p_status violates operator_subscriptions_status_check (existing
--     constraint from migration 036)
--   - the operators UPDATE affects zero rows (p_operator_id does not exist —
--     a defensive check; every current caller already only ever passes a
--     real, existing operator's id, so this should never fire in practice,
--     but guards against ever silently no-op'ing half the atomic pair)
--
-- SECURITY DEFINER so it can be called via RPC using the same service-role
-- access every current caller (createAdminClient()) already has — this does
-- not expand privileges beyond today's access model.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_operator_plan_entitlement(
  p_operator_id                      UUID,
  p_plan_code                        TEXT,
  p_status                           TEXT DEFAULT 'active',
  p_billing_provider                 TEXT DEFAULT 'manual',
  p_billing_provider_customer_id     TEXT DEFAULT NULL,
  p_billing_provider_subscription_id TEXT DEFAULT NULL,
  p_current_period_start             TIMESTAMPTZ DEFAULT NULL,
  p_current_period_end               TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.operator_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      public.operator_subscriptions;
  v_rowcount INTEGER;
BEGIN
  INSERT INTO public.operator_subscriptions (
    operator_id,
    plan_code,
    status,
    billing_provider,
    billing_provider_customer_id,
    billing_provider_subscription_id,
    current_period_start,
    current_period_end
  )
  VALUES (
    p_operator_id,
    p_plan_code,
    p_status,
    p_billing_provider,
    p_billing_provider_customer_id,
    p_billing_provider_subscription_id,
    p_current_period_start,
    p_current_period_end
  )
  ON CONFLICT (operator_id) DO UPDATE SET
    plan_code                         = EXCLUDED.plan_code,
    status                            = EXCLUDED.status,
    billing_provider                  = EXCLUDED.billing_provider,
    billing_provider_customer_id      = EXCLUDED.billing_provider_customer_id,
    billing_provider_subscription_id  = EXCLUDED.billing_provider_subscription_id,
    current_period_start              = EXCLUDED.current_period_start,
    current_period_end                = EXCLUDED.current_period_end,
    updated_at                        = now()
  RETURNING * INTO v_row;

  UPDATE public.operators
  SET plan = p_plan_code
  WHERE id = p_operator_id;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'sync_operator_plan_entitlement: operator % not found — rolling back', p_operator_id;
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.sync_operator_plan_entitlement IS
  'Atomically upserts operator_subscriptions and syncs operators.plan for a '
  'plan-changing operation (manual admin change, cancellation downgrade, or '
  'a Stripe sync that carries a plan change). Both writes commit or roll '
  'back together — never used for Stripe status/period-only syncs, which '
  'do not touch operators.plan and remain a single-table upsert.';


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — service_role only, matching every current caller
-- (createAdminClient()) and the same pattern as the Brevo RPC precedent.
-- No authenticated/anon execution is granted — this function is never
-- called from a client-side or non-admin context.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.sync_operator_plan_entitlement(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;
