-- =============================================================================
-- 072_event_view_events_cascade_delete.sql
--
-- Adds ON DELETE CASCADE to event_view_events.event_id so deleting an event
-- no longer fails when it has anonymous page-view history.
--
-- CONTEXT:
--   042_analytics_foundation.sql defined event_view_events.event_id as:
--
--     event_id UUID NOT NULL REFERENCES public.events(id)
--
--   with no ON DELETE clause, i.e. the Postgres default NO ACTION. Every
--   other event-child table (event_slug_history, content_guide_events,
--   consumer_saved_events, collection_event_overrides,
--   discover_event_overrides) already uses ON DELETE CASCADE — this table
--   was the one exception.
--
--   Confirmed directly (constraint "event_view_events_event_id_fkey",
--   confdeltype = 'a'): deleting any event with one or more
--   event_view_events rows fails with:
--
--     ERROR: 23503: update or delete on table "events" violates foreign key
--     constraint "event_view_events_event_id_fkey" on table
--     "event_view_events"
--
--   Reproduced live against "Prime Rib Sunday - test"
--   (77cbf147-a904-464f-a08a-f00db74f1073, Gulfstream, 21 view rows). This
--   is a table-level constraint enforced by Postgres regardless of caller —
--   it blocks founder impersonation, normal operator login, seeded events,
--   and operator-created events identically; the only variable is whether
--   the event happens to have any view-history rows at all.
--
-- WHAT THIS MIGRATION DOES:
--   Drops and recreates event_view_events_event_id_fkey with ON DELETE
--   CASCADE — the constraint name, referenced table/column, NOT NULL, and
--   every other column property are unchanged. No indexes are affected
--   (event_view_events_pkey and event_view_events_event_id_idx are
--   independent of this FK constraint). No triggers, views, or other
--   objects depend on this constraint besides Postgres's own internal FK
--   enforcement triggers, which are recreated automatically.
--
-- WHAT THIS MIGRATION DOES NOT DO:
--   - No changes to event-view logging, analytics queries, or retention
--     behavior for any event that is NOT deleted — existing view rows for
--     live events are completely unaffected.
--   - No changes to application code, RLS, or any other table.
--   - No changes to any other event-child table's existing CASCADE
--     behavior — all already cascade correctly.
-- =============================================================================

ALTER TABLE public.event_view_events
  DROP CONSTRAINT event_view_events_event_id_fkey;

ALTER TABLE public.event_view_events
  ADD CONSTRAINT event_view_events_event_id_fkey
  FOREIGN KEY (event_id)
  REFERENCES public.events(id)
  ON DELETE CASCADE;
