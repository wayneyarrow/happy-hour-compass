-- =============================================================================
-- Happy Hour Compass — plan_change_events venue_id (Phase 2A additive foundation)
-- Migration: 084_plan_change_events_venue_id.sql
--
-- PURPOSE:
--   Adds venue_id to plan_change_events so a plan-change record can identify
--   WHICH venue changed plan, not just which operator. This closes a real,
--   already-live observability gap: notifyFounderOfPlanChange()
--   (src/lib/planChangeEvents.ts) currently has no venue on its payload and
--   falls back to getOperatorVenues()[0] to name a venue in the Slack/email
--   notification — silently wrong for any multi-venue operator today (see
--   the Phase 2 investigation report, Part 12).
--
--   Phase 2A scope: additive and nullable only. Nothing in the live write
--   path (changePlanAction, the three plan-changing Stripe webhook branches,
--   cancelVenueAction — all still operator-scoped) is changed to populate
--   this column yet. Phase 2B will make it part of the live write contract
--   once venue-scoped plan changes become the real write path; it is not
--   made NOT NULL here because every existing writer would then need to
--   change in the same migration, which is exactly the kind of coupled,
--   non-additive change Phase 2A is scoped to avoid.
--
-- DESIGN NOTES:
--   - No ON DELETE action specified (defaults to RESTRICT/NO ACTION),
--     mirroring this same table's existing operator_id FK
--     (plan_change_events_operator_id_fkey has no ON DELETE clause either) —
--     a plan-change audit row's venue reference behaves the same way its
--     operator reference already does on delete.
--   - Index added now (rather than deferred) because Phase 2B's venue-scoped
--     subscription page and Control Panel plan-change history will query by
--     venue_id as their primary access pattern — same reasoning as the
--     existing plan_change_events_operator_id_idx.
--   - No new GRANT needed: GRANT ALL ON plan_change_events TO service_role
--     (migration 042) already covers every column on this table, including
--     one added later via ALTER TABLE.
-- =============================================================================


-- ── 1. Add column ─────────────────────────────────────────────────────────────

ALTER TABLE public.plan_change_events
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES public.venues(id);

COMMENT ON COLUMN public.plan_change_events.venue_id IS
  'Which venue this plan change applied to. Nullable in Phase 2A for '
  'compatibility with the still-active operator-level write path — none of '
  'changePlanAction, the Stripe webhook route, or cancelVenueAction populate '
  'it yet. Phase 2B will populate this on every new write once venue-scoped '
  'plan changes become the live write path, and may make it required at '
  'that point. Existing rows written before this migration are left NULL, '
  'not backfilled — Phase 2A had no reliable single-venue attribution for '
  'historical operator-level events (the exact ambiguity this whole '
  'migration exists to stop guessing at) beyond the single-venue-operator '
  'case, which is not worth a special-cased partial backfill for a purely '
  'observational column.';


-- ── 2. Index ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS plan_change_events_venue_id_idx
  ON public.plan_change_events (venue_id);
