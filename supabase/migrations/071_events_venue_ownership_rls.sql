-- =============================================================================
-- 071_events_venue_ownership_rls.sql
--
-- Fixes events RLS to authorize by venue ownership instead of
-- created_by_operator_id, and adds the missing DELETE policy.
--
-- CONTEXT:
--   The application-level event ownership logic (saveEventAction,
--   deleteEventAction — src/app/admin/events/actions.ts) was recently
--   corrected to scope UPDATE/DELETE by the event's venue_id rather than
--   created_by_operator_id, because every platform-seeded event has
--   created_by_operator_id = NULL. Founder impersonation already works
--   under that fix because impersonation uses the admin/service-role
--   Supabase client, which bypasses RLS entirely.
--
--   A normal (non-impersonating) operator login uses the RLS-respecting
--   request-scoped client instead. Under the ORIGINAL policies below, that
--   client is still blocked independently of the application-level fix:
--
--     "events: update own" (001_initial_schema.sql) — USING
--       (created_by_operator_id IN (SELECT id FROM operators WHERE email =
--       auth.jwt()->>'email')) — can never match a seeded event, regardless
--       of which venue it belongs to or who manages that venue.
--
--     001_initial_schema.sql (the tracked source of truth for this table's
--     original policies) never defined a DELETE policy for events. Live
--     inspection of the current database via the Supabase Management API
--     found that a DELETE policy named "events: delete own" exists anyway,
--     with the identical created_by_operator_id-keyed predicate as the
--     UPDATE policy — applied out-of-band at some point (this project's
--     tracked supabase_migrations.schema_migrations history stops at 066,
--     four versions behind the migrations folder, confirming migrations
--     here are sometimes applied via the Dashboard SQL Editor rather than
--     `supabase db push`, per each file's own "HOW TO APPLY" header). It has
--     the same bug as the UPDATE policy: it can never match a seeded event.
--     This migration drops it by its actual live name alongside the tracked
--     "events: update own", regardless of which one(s) exist in a given
--     environment.
--
-- WHAT THIS MIGRATION DOES:
--   1. Replaces "events: update own" with a venue-ownership-based UPDATE
--      policy — the same "venue_id IN (SELECT v.id FROM venues v JOIN
--      operators o ON o.id = v.created_by_operator_id WHERE o.email = ...)"
--      shape already used by "media: insert for own venue" and
--      "media: delete for own venue" (001_initial_schema.sql). This allows
--      both operator-created and platform-seeded events belonging to the
--      operator's own venue, and continues to deny events belonging to any
--      other venue.
--   2. Replaces "events: delete own" (the untracked, out-of-band policy
--      described above — dropped IF EXISTS, safe on environments where it
--      was never created) with "events: delete for own venue", the DELETE
--      analogue of the same venue-ownership policy shape — mirroring
--      "media: delete for own venue" exactly.
--
-- WHAT THIS MIGRATION DOES NOT DO:
--   - SELECT ("events: authenticated read", USING (TRUE)) is untouched.
--   - INSERT ("events: insert authenticated", WITH CHECK (TRUE)) is
--     untouched — application code already sets created_by_operator_id
--     correctly on insert; ownership at insert time was never the problem.
--   - No GRANT changes — 039_security_hardening.sql already granted
--     SELECT, INSERT, UPDATE, DELETE on public.events to authenticated; the
--     DELETE grant already existed, just with no permissive policy to use it.
--   - Plan entitlements (recurring-event restrictions, seeded-event
--     grandfathering) are enforced entirely in application code
--     (src/lib/plans.ts, saveEventAction) and are unaffected by this
--     migration — RLS here only ever decided *which venue's rows* a caller
--     may touch, never *what kind of event* they may create/change.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE: replace created_by_operator_id scoping with venue-ownership scoping
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "events: update own" ON public.events;

CREATE POLICY "events: update for own venue"
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (
    venue_id IN (
      SELECT v.id
      FROM public.venues v
      JOIN public.operators o ON o.id = v.created_by_operator_id
      WHERE o.email = (auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    venue_id IN (
      SELECT v.id
      FROM public.venues v
      JOIN public.operators o ON o.id = v.created_by_operator_id
      WHERE o.email = (auth.jwt() ->> 'email')
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE: replace the untracked out-of-band "events: delete own" policy
-- (dropped IF EXISTS — also safe on an environment where it was never
-- created, matching 001_initial_schema.sql's tracked history exactly)
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "events: delete own" ON public.events;

CREATE POLICY "events: delete for own venue"
  ON public.events
  FOR DELETE
  TO authenticated
  USING (
    venue_id IN (
      SELECT v.id
      FROM public.venues v
      JOIN public.operators o ON o.id = v.created_by_operator_id
      WHERE o.email = (auth.jwt() ->> 'email')
    )
  );
