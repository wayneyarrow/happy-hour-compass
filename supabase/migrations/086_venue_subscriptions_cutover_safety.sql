-- =============================================================================
-- Happy Hour Compass — Venue Subscriptions Cutover Safety (Phase 2B)
-- Migration: 086_venue_subscriptions_cutover_safety.sql
--
-- PURPOSE:
--   Closes the deployment-window gap between migration 083 (which backfilled
--   venue_subscriptions once, at the time it was applied) and Phase 2B live
--   code actually going live. Between those two points, an operator could in
--   principle have been moved to a paid plan through the still-live legacy
--   operator-level path (manual admin change, or a Stripe event landing on
--   the old operator_subscriptions flow) with no corresponding
--   venue_subscriptions row ever created — Phase 2A was additive-only and
--   never wrote venue_subscriptions from live code. This migration re-runs
--   083's exact backfill safeguard immediately before Phase 2B code starts
--   reading venue_subscriptions live, so that gap can never silently persist
--   into the venue-scoped era.
--
--   Also adds the Stripe-identity integrity constraints Phase 2B's "one
--   Stripe Customer per venue" decision depends on (Part 2D) — see section 2
--   below.
--
-- SAFEGUARD (identical logic to migration 083 — see that migration's header
-- for the full rationale, reproduced here for a self-contained record):
--   COALESCE(os.plan_code, o.plan) covers both a real operator_subscriptions
--   row and the legacy manual-plan-with-no-row case in one expression. If
--   ANY operator whose resolved plan is not 'free' owns more than one
--   venue, this block RAISES and the entire migration fails — no
--   venue_subscriptions row is ever written for an ambiguous operator. It
--   never guesses. A venue that already has a venue_subscriptions row
--   (from 083's original run, or a live Phase 2B Stripe/manual write since)
--   is left untouched (`ON CONFLICT (venue_id) DO NOTHING`) — this migration
--   only fills genuinely missing rows, it never overwrites an existing one.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Stripe identity integrity (Part 2D)
--
-- One Stripe Customer belongs to exactly one venue, and one Stripe
-- Subscription belongs to exactly one venue — enforced at the database
-- level, not just in application code. Partial unique indexes (WHERE ...
-- IS NOT NULL) so any number of Free venues with a null customer/
-- subscription id can coexist without violating uniqueness; only an actual
-- duplicate non-null Stripe id across two venues is rejected.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS venue_subscriptions_customer_id_key
  ON public.venue_subscriptions (billing_provider_customer_id)
  WHERE billing_provider_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS venue_subscriptions_subscription_id_key
  ON public.venue_subscriptions (billing_provider_subscription_id)
  WHERE billing_provider_subscription_id IS NOT NULL;

COMMENT ON INDEX venue_subscriptions_customer_id_key IS
  'Enforces one Stripe Customer per venue at the database level — two '
  'venues can never accidentally share the same billing_provider_customer_id. '
  'Partial (WHERE NOT NULL) so any number of Free venues with no Stripe '
  'customer yet can coexist.';

COMMENT ON INDEX venue_subscriptions_subscription_id_key IS
  'Enforces one Stripe Subscription per venue at the database level — two '
  'venues can never accidentally share the same '
  'billing_provider_subscription_id. Partial (WHERE NOT NULL) for the same '
  'reason as venue_subscriptions_customer_id_key.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Deployment-window backfill safeguard (re-run of migration 083's logic)
-- ─────────────────────────────────────────────────────────────────────────────

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
      'venue_subscriptions cutover backfill aborted: % paid operator(s) own '
      'more than one venue with no unambiguous single-venue assignment: %. '
      'This migration refuses to guess (see migration 086 header, and '
      'migration 083 for the original rationale). Resolve manually — decide '
      'which venue keeps the paid subscription, clear/reassign the rest — '
      'then re-run this migration.',
      array_length(ambiguous_operator_ids, 1),
      ambiguous_operator_ids;
  END IF;

  -- Safe to proceed: every currently-paid operator (if any) owns exactly
  -- one venue. Free operators are excluded by the plan_code <> 'free'
  -- filter entirely — no row is created for them. A venue that already has
  -- a venue_subscriptions row (from 083, or any live write since) is left
  -- untouched by ON CONFLICT DO NOTHING — this only fills genuinely
  -- missing rows.
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
