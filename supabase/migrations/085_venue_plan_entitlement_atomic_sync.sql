-- =============================================================================
-- Happy Hour Compass — Atomic Venue Plan Entitlement Sync (Phase 2A foundation)
-- Migration: 085_venue_plan_entitlement_atomic_sync.sql
--
-- PURPOSE:
--   Venue-scoped equivalent of sync_operator_plan_entitlement() (migration
--   081), built ahead of need so Phase 2B has a proven atomic write
--   mechanism ready to become the sole authoritative venue-plan write path.
--
--   Unlike migration 081's function, this one does NOT need to update a
--   second table/column atomically alongside the subscription upsert:
--   venue_subscriptions.plan_code is the ONLY venue-level plan
--   representation (there is deliberately no venues.plan column — see
--   migration 083's header, "one authoritative venue-level plan source").
--   sync_venue_plan_entitlement() is therefore a single-table upsert, and
--   is atomic by construction the same way a lone SQL statement always is —
--   it does not depend on operators.plan, does not update operators.plan,
--   and does not read operator-level plan state as its source of truth. It
--   is still implemented as a SECURITY DEFINER RPC (rather than left as a
--   plain upsert the app performs directly) for parity with the established
--   081/075 pattern, and so Phase 2B's write path is already in place and
--   already unit-testable via the same static-verification approach used
--   for 081 — not because atomicity across two tables is a concern here.
--
-- PHASE 2A STATUS:
--   This function is created but UNUSED by any live application code path
--   in Phase 2A — no Checkout, webhook, or admin action calls it yet. It
--   exists so Phase 2B can adopt it directly (via a getVenueSubscription-
--   style helper in src/lib/venueSubscriptions.ts) without a further schema
--   change. See that file's header for the application-layer contract this
--   RPC is intended to sit behind.
--
-- PRECEDENT:
--   Follows the SECURITY DEFINER RPC pattern established by
--   enqueue_brevo_contact_sync()/claim_brevo_outbox_batch() (075) and
--   sync_operator_plan_entitlement() (081) — same LANGUAGE plpgsql,
--   SECURITY DEFINER, SET search_path = public shape. The GRANT section
--   follows 075's fuller form (explicit REVOKE FROM PUBLIC/anon/
--   authenticated before GRANT ... TO service_role) from the start — see
--   the GRANTs section below for why that distinction matters for a
--   SECURITY DEFINER function. Migration 081 originally shipped without
--   this REVOKE; migration 082 (applied earlier in this same migration
--   set) retroactively hardens 081's already-live function to the same
--   standard — see 082's own header for that fix.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: sync_venue_plan_entitlement
--
-- Atomically upserts venue_subscriptions for a plan-changing write (manual
-- admin/founder change, an operator-initiated venue cancellation downgrade,
-- or a Stripe sync that carries a plan change — mirroring the three call-
-- site categories sync_operator_plan_entitlement() already serves). A
-- single INSERT ... ON CONFLICT DO UPDATE is atomic on its own; this
-- function does not touch any other table.
--
-- Raises if:
--   - p_plan_code violates venue_subscriptions_plan_code_check (migration
--     083 — free | pro | premium | enterprise only)
--   - p_status violates venue_subscriptions_status_check (migration 083)
--   - p_venue_id does not reference an existing venue (the FK constraint on
--     venue_subscriptions.venue_id already enforces this; no separate
--     defensive check is needed the way migration 081's function needed one
--     for its second UPDATE statement, because there is only one statement
--     here and the FK violation already raises on its own)
--
-- SECURITY DEFINER so it can be called via RPC using the same service-role
-- access every planned caller (createAdminClient()) will use — matches the
-- access model already in effect for sync_operator_plan_entitlement().
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_venue_plan_entitlement(
  p_venue_id                         UUID,
  p_plan_code                        TEXT,
  p_status                           TEXT DEFAULT 'active',
  p_billing_provider                 TEXT DEFAULT 'manual',
  p_billing_provider_customer_id     TEXT DEFAULT NULL,
  p_billing_provider_subscription_id TEXT DEFAULT NULL,
  p_current_period_start             TIMESTAMPTZ DEFAULT NULL,
  p_current_period_end               TIMESTAMPTZ DEFAULT NULL,
  p_cancel_at_period_end             BOOLEAN DEFAULT false
)
RETURNS public.venue_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.venue_subscriptions;
BEGIN
  INSERT INTO public.venue_subscriptions (
    venue_id,
    plan_code,
    status,
    billing_provider,
    billing_provider_customer_id,
    billing_provider_subscription_id,
    current_period_start,
    current_period_end,
    cancel_at_period_end
  )
  VALUES (
    p_venue_id,
    p_plan_code,
    p_status,
    p_billing_provider,
    p_billing_provider_customer_id,
    p_billing_provider_subscription_id,
    p_current_period_start,
    p_current_period_end,
    p_cancel_at_period_end
  )
  ON CONFLICT (venue_id) DO UPDATE SET
    plan_code                         = EXCLUDED.plan_code,
    status                            = EXCLUDED.status,
    billing_provider                  = EXCLUDED.billing_provider,
    billing_provider_customer_id      = EXCLUDED.billing_provider_customer_id,
    billing_provider_subscription_id  = EXCLUDED.billing_provider_subscription_id,
    current_period_start              = EXCLUDED.current_period_start,
    current_period_end                = EXCLUDED.current_period_end,
    cancel_at_period_end              = EXCLUDED.cancel_at_period_end,
    updated_at                        = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.sync_venue_plan_entitlement IS
  'Atomically upserts venue_subscriptions for a plan-changing operation. '
  'Single-table by design — venue_subscriptions.plan_code is the only '
  'venue-level plan representation, so there is no second column/table to '
  'keep in sync the way sync_operator_plan_entitlement() (migration 081) '
  'must for operators.plan. Never reads or writes operators.plan or any '
  'operator-level table. Unused by live application code as of migration '
  '085 (Phase 2A) — reserved for Phase 2B.';


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs — service_role only.
--
-- PostgreSQL grants EXECUTE on every newly created function to PUBLIC by
-- default (unlike tables, which have no default grants) — a bare
-- `GRANT EXECUTE ... TO service_role` on its own does NOT remove that
-- default and would leave this SECURITY DEFINER function callable by
-- `anon`/`authenticated` (both inherit PUBLIC), which could write directly
-- to venue_subscriptions with elevated privileges and bypass RLS entirely.
-- Explicit REVOKE FROM PUBLIC/anon/authenticated closes that gap.
--
-- This is the real, established precedent for a SECURITY DEFINER RPC in
-- this codebase — migration 075_brevo_sync_outbox.sql's
-- enqueue_brevo_contact_sync()/claim_brevo_outbox_batch() both REVOKE before
-- granting. Migration 081_operator_plan_entitlement_atomic_sync.sql
-- (already shipped to production) originally omitted the REVOKE — that gap
-- is retroactively closed by migration 082_harden_operator_plan_
-- entitlement_rpc_permissions.sql, applied earlier in this same migration
-- set, rather than by editing 081's already-shipped SQL in place.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.sync_venue_plan_entitlement(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.sync_venue_plan_entitlement(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.sync_venue_plan_entitlement(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.sync_venue_plan_entitlement(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN
) TO service_role;
