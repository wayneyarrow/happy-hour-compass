-- =============================================================================
-- Happy Hour Compass — Venue Subscriptions (Phase 2A additive foundation)
-- Migration: 083_venue_subscriptions.sql
--
-- PURPOSE:
--   Phase 2 target architecture: Operator = identity/access, Venue =
--   independently managed business, Plan/subscription = venue-specific.
--   This migration is ADDITIVE FOUNDATION ONLY (Phase 2A). It introduces
--   venue_subscriptions as the future authoritative venue-level plan source,
--   but does NOT change any live entitlement/read path — operators.plan and
--   operator_subscriptions remain exactly as they are and continue to power
--   the live application until Phase 2B cuts callers over.
--
--   Decisions already made (see Phase 2 investigation report and the Phase 2A
--   task brief):
--     - One Stripe Customer per venue (not per operator).
--     - No venue_subscriptions row required for a Free venue — same lazy-
--       creation precedent as operator_subscriptions (migration 036):
--         row exists → use plan_code
--         no row     → Free
--     - operators.plan / operator_subscriptions are NOT a permanent fallback
--       once venue-level plans are live — once one operator can own venues
--       with different plans, there is no single correct operators.plan
--       value to fall back to (see src/lib/venueSubscriptions.ts header for
--       the application-layer half of this rule).
--
-- DESIGN NOTES (mirrors migration 036's structure, scoped to venue_id):
--   - plan_code / status use the exact same value sets as operator_subscriptions
--     — no new enum/vocabulary invented for Phase 2.
--   - billing_provider defaults to 'manual', matching operator_subscriptions.
--   - cancel_at_period_end is new (operator_subscriptions has no equivalent)
--     — Phase 2B will wire Stripe webhook state into it; it exists on this
--     table now purely as an additive column with a safe default.
--   - One subscription per venue enforced via UNIQUE on venue_id — this IS
--     the venue-level equivalent of operator_subscriptions' UNIQUE(operator_id),
--     and it is the intended long-term model (one Stripe Customer per venue,
--     Part 6 of the investigation), not a V1-only placeholder.
--   - venue_id REFERENCES venues(id) ON DELETE CASCADE: unlike venues' own
--     operator FKs (created_by_operator_id etc., which use ON DELETE SET NULL
--     because a venue must survive its operator being removed), a
--     venue_subscriptions row has no meaning without its venue — cascading
--     delete is correct here.
--   - RLS enabled, no permissive policies — service-role only, identical
--     posture to operator_subscriptions. No current or planned caller needs
--     authenticated-session access; every read/write goes through
--     createAdminClient().
--   - Deliberately does NOT add venues.plan. There must be exactly one
--     authoritative venue-level plan source (this table), not a second
--     duplicated cache column — the exact anti-pattern migration 081 had to
--     retrofit atomicity onto for operators.plan/operator_subscriptions.
-- =============================================================================


-- ── 1. Create table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.venue_subscriptions (
  id                                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id                          UUID        NOT NULL
                                               REFERENCES public.venues(id)
                                               ON DELETE CASCADE,
  plan_code                         TEXT        NOT NULL DEFAULT 'free',
  status                            TEXT        NOT NULL DEFAULT 'active',
  billing_provider                  TEXT        NOT NULL DEFAULT 'manual',
  billing_provider_customer_id      TEXT,
  billing_provider_subscription_id  TEXT,
  current_period_start              TIMESTAMPTZ,
  current_period_end                TIMESTAMPTZ,
  cancel_at_period_end              BOOLEAN     NOT NULL DEFAULT false,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT venue_subscriptions_venue_id_key
    UNIQUE (venue_id),
  CONSTRAINT venue_subscriptions_plan_code_check
    CHECK (plan_code IN ('free', 'pro', 'premium', 'enterprise')),
  CONSTRAINT venue_subscriptions_status_check
    CHECK (status IN ('active', 'pending', 'cancelled', 'past_due'))
);

COMMENT ON TABLE public.venue_subscriptions IS
  'One row per venue — future authoritative venue-level subscription/plan '
  'source (Phase 2). NOT yet read by any live application code as of '
  'migration 083 (Phase 2A) — operators.plan / operator_subscriptions remain '
  'the live source until Phase 2B cuts entitlement call sites over. A venue '
  'with no row here is Free; a row is only ever created for a venue that has '
  'been on a paid plan at some point, matching operator_subscriptions'' '
  'existing lazy-creation behavior.';

COMMENT ON COLUMN public.venue_subscriptions.venue_id IS
  'FK to venues(id). UNIQUE — one subscription per venue, matching the '
  'decided Stripe model of one Customer per venue (not per operator).';

COMMENT ON COLUMN public.venue_subscriptions.plan_code IS
  'Active plan for this venue: free | pro | premium | enterprise. '
  'Independent per venue — two venues owned by the same operator may hold '
  'different values (the entire point of Phase 2).';

COMMENT ON COLUMN public.venue_subscriptions.status IS
  'Subscription lifecycle: active | pending | cancelled | past_due. '
  'Same vocabulary as operator_subscriptions.status.';

COMMENT ON COLUMN public.venue_subscriptions.billing_provider IS
  'Payment processor: manual (default) | stripe.';

COMMENT ON COLUMN public.venue_subscriptions.billing_provider_customer_id IS
  'Stripe customer ID (cus_...) for THIS venue''s own Stripe Customer — '
  'Phase 2 decision is one Stripe Customer per venue, not per operator. '
  'Null until Stripe checkout is wired to venue_id in Phase 2B.';

COMMENT ON COLUMN public.venue_subscriptions.billing_provider_subscription_id IS
  'Stripe subscription ID (sub_...) for this venue. Null until Phase 2B.';

COMMENT ON COLUMN public.venue_subscriptions.current_period_start IS
  'Start of the current billing period. Null for manual/free plans.';

COMMENT ON COLUMN public.venue_subscriptions.current_period_end IS
  'End of the current billing period. Null for manual/free plans.';

COMMENT ON COLUMN public.venue_subscriptions.cancel_at_period_end IS
  'True when Stripe has recorded a pending end-of-period cancellation for '
  'this venue''s subscription (e.g. chosen via the Stripe Customer Portal). '
  'No equivalent column exists on operator_subscriptions today — this is a '
  'net-new capability, added here rather than retrofitted onto the legacy '
  'table. Phase 2B wires the Stripe webhook (customer.subscription.updated) '
  'into this field; Phase 2A never writes it from live code.';


-- ── 2. Indexes ────────────────────────────────────────────────────────────────
-- venue_subscriptions_venue_id_key (UNIQUE constraint above) already creates
-- the implicit index covering the primary venue lookup. Only one additional
-- index is added, mirroring operator_subscriptions' status index for future
-- health/ops queries — no other index is needed yet.

CREATE INDEX IF NOT EXISTS venue_subscriptions_status_idx
  ON public.venue_subscriptions (status);


-- ── 3. updated_at trigger ─────────────────────────────────────────────────────
-- Reuses the update_updated_at() function defined in 001_initial_schema.sql.

CREATE TRIGGER venue_subscriptions_updated_at
  BEFORE UPDATE ON public.venue_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ── 4. RLS — enabled, no permissive policies ──────────────────────────────────
-- Matches operator_subscriptions' exact posture: internal, service-role only.
-- Application uses createAdminClient() (service-role), which bypasses RLS.

ALTER TABLE public.venue_subscriptions ENABLE ROW LEVEL SECURITY;


-- ── 5. GRANTs — service_role only ─────────────────────────────────────────────
-- Required per CLAUDE.md (Supabase removes automatic grants for new
-- public-schema tables starting October 30 2026). No anon/authenticated
-- access — this table has no direct-from-client reader today or planned,
-- same as operator_subscriptions.

GRANT ALL ON public.venue_subscriptions TO service_role;


-- ── 6. Backfill safeguard + copy for any operator already on a paid plan ─────
--
-- Must be safe no matter when this migration actually deploys — production
-- data may have changed between the Phase 2 investigation (0 paid operators)
-- and execution. This block re-derives the answer at run time rather than
-- trusting any previously-recorded count.
--
-- COALESCE(os.plan_code, o.plan) intentionally covers BOTH:
--   (a) an operator with a real operator_subscriptions row, AND
--   (b) the legacy case of operators.plan != 'free' with NO
--       operator_subscriptions row at all (Part 3D of the task) —
-- with one expression, since both must resolve to the same "this operator's
-- current plan" value and both carry the identical ambiguity risk for a
-- multi-venue operator.
--
-- Safeguard: if ANY operator whose resolved plan is not 'free' owns more
-- than one venue, this block RAISES and the entire migration fails, and no
-- venue_subscriptions row is EVER written for an ambiguous operator. It
-- never guesses: not venues[0], not alphabetical, not duplicating one
-- subscription across venues, not marking every venue paid.
--
-- Verified against a real Postgres engine (see the Phase 2A final-review
-- task report): when this file is applied as a single script — `psql -f`,
-- Supabase's own migration runner, and the Dashboard SQL editor all do this
-- — a later RAISE EXCEPTION rolls back the ENTIRE file as one transaction,
-- including the CREATE TABLE/GRANT/RLS/trigger statements above it. A
-- failed run therefore leaves NOTHING behind, not even the table — this is
-- Postgres's standard simple-query-protocol behavior for a multi-statement
-- script with no explicit BEGIN/COMMIT, not something this migration has to
-- engineer itself. (If some future tooling ever executed this file
-- statement-by-statement in autocommit mode instead of as one script, the
-- DDL above the DO block could commit independently before the safeguard
-- runs — but no venue_subscriptions ROW would still ever be written for an
-- ambiguous operator either way, since the RAISE always fires before the
-- backfill INSERT is reached.)
--
-- A failed migration blocks deployment until a human resolves the ambiguity
-- (e.g. by manually deciding which venue keeps the paid subscription and
-- clearing the rest) and this migration is re-run — CREATE TABLE IF NOT
-- EXISTS / CREATE INDEX IF NOT EXISTS / ON CONFLICT DO NOTHING below make
-- every statement in this file idempotent and safe to re-run either way.
DO $$
DECLARE
  ambiguous_operator_ids UUID[];
BEGIN
  SELECT array_agg(sub.operator_id)
  INTO ambiguous_operator_ids
  FROM (
    SELECT v.created_by_operator_id AS operator_id, count(*) AS venue_count
    FROM public.venues v
    JOIN public.operators o
      ON o.id = v.created_by_operator_id
    LEFT JOIN public.operator_subscriptions os
      ON os.operator_id = o.id
    WHERE v.created_by_operator_id IS NOT NULL
      AND COALESCE(os.plan_code, o.plan) <> 'free'
    GROUP BY v.created_by_operator_id
    HAVING count(*) > 1
  ) sub;

  IF ambiguous_operator_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'venue_subscriptions backfill aborted: % paid operator(s) own more '
      'than one venue with no unambiguous single-venue assignment: %. '
      'This migration refuses to guess (see migration 083 header). '
      'Resolve manually — decide which venue keeps the paid subscription, '
      'clear/reassign the rest — then re-run this migration.',
      array_length(ambiguous_operator_ids, 1),
      ambiguous_operator_ids;
  END IF;

  -- Safe to proceed: every currently-paid operator (if any) owns exactly
  -- one venue. Free operators are excluded by the plan_code <> 'free' filter
  -- entirely — no row is created for them, matching "no row means Free."
  INSERT INTO public.venue_subscriptions (
    venue_id,
    plan_code,
    status,
    billing_provider,
    billing_provider_customer_id,
    billing_provider_subscription_id,
    current_period_start,
    current_period_end
  )
  SELECT
    v.id,
    COALESCE(os.plan_code, o.plan),
    COALESCE(os.status, 'active'),
    COALESCE(os.billing_provider, 'manual'),
    os.billing_provider_customer_id,
    os.billing_provider_subscription_id,
    os.current_period_start,
    os.current_period_end
  FROM public.venues v
  JOIN public.operators o
    ON o.id = v.created_by_operator_id
  LEFT JOIN public.operator_subscriptions os
    ON os.operator_id = o.id
  WHERE v.created_by_operator_id IS NOT NULL
    AND COALESCE(os.plan_code, o.plan) <> 'free'
    AND (
      SELECT count(*) FROM public.venues v2
      WHERE v2.created_by_operator_id = v.created_by_operator_id
    ) = 1
  ON CONFLICT (venue_id) DO NOTHING;
END;
$$;
