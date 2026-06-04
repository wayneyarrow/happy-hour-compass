-- =============================================================================
-- Happy Hour Compass — Operator Subscriptions
-- Migration: 036_operator_subscriptions.sql
--
-- PURPOSE:
--   Adds operator_subscriptions as the canonical subscription source of truth.
--   operators.plan is retained as a backward-compatibility cache column and
--   kept in sync by the application layer whenever a plan change occurs.
--
-- DESIGN NOTES:
--   - plan_code mirrors the valid values in operators.plan so the two columns
--     stay trivially in sync with no value transformation required.
--   - billing_provider defaults to 'manual' for V1 (no payment processor yet).
--     billing_provider_customer_id and billing_provider_subscription_id are
--     nullable Stripe-reserved columns — no schema change required to add Stripe.
--   - current_period_start / current_period_end are nullable for manual plans.
--     Stripe webhooks will populate them when billing is added.
--   - One subscription per operator enforced via UNIQUE on operator_id (V1).
--     When Stripe multi-record history is needed, drop the unique constraint
--     and add:
--       CREATE UNIQUE INDEX ... ON operator_subscriptions (operator_id)
--       WHERE status IN ('active', 'pending');
--   - RLS is enabled; no permissive policies. The application uses
--     createAdminClient() (service-role) which bypasses RLS entirely.
-- =============================================================================


-- ── 1. Create table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.operator_subscriptions (
  id                                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id                       UUID        NOT NULL
                                               REFERENCES public.operators(id)
                                               ON DELETE CASCADE,
  plan_code                         TEXT        NOT NULL DEFAULT 'free',
  status                            TEXT        NOT NULL DEFAULT 'active',
  billing_provider                  TEXT        NOT NULL DEFAULT 'manual',
  billing_provider_customer_id      TEXT,
  billing_provider_subscription_id  TEXT,
  current_period_start              TIMESTAMPTZ,
  current_period_end                TIMESTAMPTZ,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT operator_subscriptions_operator_id_key
    UNIQUE (operator_id),
  CONSTRAINT operator_subscriptions_plan_code_check
    CHECK (plan_code IN ('free', 'pro', 'premium', 'enterprise')),
  CONSTRAINT operator_subscriptions_status_check
    CHECK (status IN ('active', 'pending', 'cancelled', 'past_due'))
);

COMMENT ON TABLE public.operator_subscriptions IS
  'One row per operator — canonical subscription and plan source of truth. '
  'operators.plan mirrors plan_code for backward compatibility. '
  'billing_provider_customer_id and billing_provider_subscription_id '
  'are reserved for future Stripe integration.';

COMMENT ON COLUMN public.operator_subscriptions.operator_id IS
  'FK to operators(id). UNIQUE in V1 — one active subscription per operator.';

COMMENT ON COLUMN public.operator_subscriptions.plan_code IS
  'Active plan: free | pro | premium | enterprise. '
  'Must stay in sync with operators.plan (updated together by the app layer).';

COMMENT ON COLUMN public.operator_subscriptions.status IS
  'Subscription lifecycle: active | pending | cancelled | past_due.';

COMMENT ON COLUMN public.operator_subscriptions.billing_provider IS
  'Payment processor: manual (default) | stripe.';

COMMENT ON COLUMN public.operator_subscriptions.billing_provider_customer_id IS
  'Stripe customer ID (cus_...). Null until Stripe is integrated.';

COMMENT ON COLUMN public.operator_subscriptions.billing_provider_subscription_id IS
  'Stripe subscription ID (sub_...). Null until Stripe is integrated.';

COMMENT ON COLUMN public.operator_subscriptions.current_period_start IS
  'Start of the current billing period. Null for manual plans.';

COMMENT ON COLUMN public.operator_subscriptions.current_period_end IS
  'End of the current billing period. Null for manual plans.';


-- ── 2. Indexes ────────────────────────────────────────────────────────────────
-- The UNIQUE constraint above already creates an implicit index on operator_id.
-- Additional index on status supports future queries filtering by plan health.

CREATE INDEX IF NOT EXISTS operator_subscriptions_status_idx
  ON public.operator_subscriptions (status);


-- ── 3. updated_at trigger ─────────────────────────────────────────────────────
-- Reuses the update_updated_at() function defined in 001_initial_schema.sql.

CREATE TRIGGER operator_subscriptions_updated_at
  BEFORE UPDATE ON public.operator_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ── 4. RLS — enabled, no permissive policies ──────────────────────────────────
-- Application uses createAdminClient() (service-role) which bypasses RLS.
-- Enabling RLS here prevents accidental authenticated-session reads.

ALTER TABLE public.operator_subscriptions ENABLE ROW LEVEL SECURITY;


-- ── 5. Backfill existing operators ───────────────────────────────────────────
-- Reads plan_code from operators.plan — the authoritative plan column prior
-- to this migration. All operators have a non-null plan value (NOT NULL DEFAULT
-- 'free' was added in migration 029).
-- ON CONFLICT DO NOTHING makes this idempotent (safe to re-run).

INSERT INTO public.operator_subscriptions (
  operator_id,
  plan_code,
  status,
  billing_provider
)
SELECT
  id,
  plan,
  'active',
  'manual'
FROM public.operators
ON CONFLICT (operator_id) DO NOTHING;
