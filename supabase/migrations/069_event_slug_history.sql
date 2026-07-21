-- =============================================================================
-- Migration 069: Event Slug History
--
-- Durable, additive infrastructure for preserving retired public event
-- slugs, so a FUTURE redirect flow can resolve an old
-- /{market}/{city}/events/{old-slug} URL to an event's current canonical
-- URL after its slug changes.
--
-- This mirrors public.venue_slug_history (migration 065_venue_slug_history.sql)
-- as closely as practical, per the approved event URL architecture Phase 1
-- plan — same shape, same design rationale, same RLS/grant posture. See
-- migration 065's header for the fuller design discussion; only the
-- event-specific deltas are repeated below.
--
-- This migration is infrastructure only:
--   - No existing event is modified. events.slug values are untouched here
--     (the backfill that regenerates them is a separate migration, 070).
--   - No history rows are inserted — this table is empty after migration,
--     and stays empty through the end of Phase 1: the 070 backfill treats
--     every existing events.slug value as disposable legacy data to be
--     fully regenerated, not a retired slug worth preserving, so it does
--     NOT write to this table. History rows only start accumulating once a
--     later, explicit event-slug-edit feature exists (not built in this
--     phase — see EventForm.tsx / saveEventAction, unchanged here).
--   - No route/lookup/redirect behaviour changes. The canonical event route
--     (/{market}/{city}/events/{event-slug}) and its UUID-compatibility
--     redirect are Phase 2 work, not part of this migration.
--   - events.slug remains TEXT UNIQUE NOT NULL, globally unique, unchanged
--     by this migration (070 changes its VALUES, not its constraints).
--
-- Resolution flow this table will support (NOT implemented by this
-- migration — Phase 2 wires the actual route lookup):
--   incoming old slug
--     -> SELECT event_id FROM event_slug_history WHERE old_slug = :slug
--     -> SELECT current slug/venue_id FROM events WHERE id = event_id
--     -> resolve current market/city slugs via the event's venue
--     -> permanent redirect to the event's CURRENT canonical URL
--
-- History resolves to event_id, never to a "new_slug" column — deliberate,
-- same as venue_slug_history: if an event's slug changes more than once,
-- every historical slug redirects straight to whatever the event's LIVE
-- slug is at request time, with no chained old-to-new lookups to walk.
--
-- Design decisions (mirroring migration 065's rationale exactly):
--   - Modeled directly on venue_slug_history (itself modeled on audit_logs,
--     migration 041_audit_logs.sql): append-only, RLS enabled with no
--     permissive policies, service-role only via GRANT ALL, no updated_at
--     column or trigger (history rows are written once and never updated).
--   - event_id ON DELETE CASCADE: a history row for an event that no longer
--     exists cannot resolve to a "current canonical URL" (there isn't one),
--     so retaining it would be a dead, unusable foreign key — the same
--     reasoning migration 065 documents for venue_id, and the same
--     convention every other event-scoped child table in this schema
--     already follows (discover_event_overrides, content_guide_events,
--     collection_items' event pins, consumer_saved_items, the analytics
--     event-view table — all CASCADE from events.id). No intentional
--     departure from the venue precedent was identified for this column.
--   - old_slug is TEXT NOT NULL and globally UNIQUE — the same scope as the
--     live events.slug constraint it complements, and the only way to
--     guarantee one historical alias can never be claimed by two events.
--     Normalization (lowercase/hyphenated, matching src/lib/slugify.ts's
--     output, always venue-slug-prefixed per src/lib/eventSlug.ts) is an
--     application-layer responsibility at write time, same as it is for
--     events.slug today — no CHECK constraint is added here, matching the
--     precedent that events.slug/venues.slug also have no format-level
--     CHECK.
--   - No trigger auto-populates this table on events.slug UPDATE, for the
--     same reason migration 065 gives: a later, separate task introduces
--     the actual slug-change write path (INSERT history row + UPDATE
--     events.slug in one transaction) once event slugs become editable.
--     Adding a trigger now would introduce hidden slug-mutation-adjacent
--     behaviour this migration is explicitly scoped to avoid.
--
--   KNOWN LIMITATION (documented, not enforced by a constraint or trigger,
--   identical in kind to venue_slug_history's limitation):
--     No ordinary constraint can span events.slug and
--     event_slug_history.old_slug together, so cross-table collision safety
--     for a future slug change is entirely that future writer's
--     responsibility. Before performing any future event slug change, the
--     writer must verify all of the following (same four checks migration
--     065 documents for venues, restated for events):
--       1. The old slug being retired does not currently belong to any
--          OTHER event.
--       2. The new slug being written to events.slug does not already
--          belong to a different event (events.slug's own UNIQUE
--          constraint enforces this at the database level; the writer
--          should still check defensively before attempting the UPDATE).
--       3. The new slug does not already exist as a historical alias for
--          any event in event_slug_history.old_slug.
--       4. The INSERT into event_slug_history and the UPDATE of
--          events.slug must happen inside the same transaction.
--     src/lib/eventSlug.ts's resolveUniqueEventSlug() already performs the
--     read-side half of this (checking both live events.slug and
--     event_slug_history.old_slug) for NEW event creation; it does not
--     perform a slug CHANGE on an existing event, which is out of scope
--     for Phase 1.
--
-- Rollback (manual, not embedded — no migration in this repo carries an
-- embedded rollback block; describing it here instead):
--   DROP TABLE IF EXISTS public.event_slug_history;
--   (Safe at any point before a later phase starts writing to it: the
--   table starts and stays empty through the end of Phase 1.)
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: event_slug_history
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_slug_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  old_slug    TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT event_slug_history_old_slug_unique UNIQUE (old_slug)
);

COMMENT ON TABLE public.event_slug_history IS
  'Append-only record of an event''s retired public slugs. Mirrors '
  'public.venue_slug_history (migration 065). Resolves an old slug to '
  'event_id only, never a chained old-to-new slug mapping, so the event''s '
  'CURRENT venue/slug (read live from events at redirect time) is always '
  'the correct target regardless of how many times the slug has changed '
  'since. Empty through the end of Phase 1 of the event URL architecture — '
  'the 070 backfill treats prior events.slug values as disposable, not '
  'worth preserving here; only a future explicit slug-edit feature '
  'populates this table.';

COMMENT ON COLUMN public.event_slug_history.event_id IS
  'The event this slug used to identify. ON DELETE CASCADE: a history row '
  'for a deleted event has no current canonical URL to redirect to, so it '
  'is not retained as a dead reference — matches every other event-scoped '
  'child table in this schema (discover_event_overrides, '
  'content_guide_events, collection event pins, consumer_saved_items, '
  'analytics event-view rows) and the identical rationale in '
  'venue_slug_history.venue_id.';

COMMENT ON COLUMN public.event_slug_history.old_slug IS
  'A retired event slug, expected in the same lowercase/hyphenated, '
  'venue-slug-prefixed form as events.slug (see src/lib/eventSlug.ts). '
  'Globally unique across this table so one historical alias can never be '
  'claimed by two events. NOT enforced here: at insert time this event''s '
  'OWN row in events.slug will normally still equal old_slug (that is what '
  'makes it "old"); the cross-table checks a future writer must run before '
  'changing a slug are documented in the migration header, not a simple '
  '"must not exist in events" rule.';

COMMENT ON COLUMN public.event_slug_history.created_at IS
  'When this slug was retired, i.e. when events.slug was changed away from '
  'this value.';


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
--
-- old_slug already has a unique btree index from the UNIQUE constraint
-- above — that alone serves the primary expected lookup
-- (old_slug = incoming route slug); no separate index is added for it.
-- ─────────────────────────────────────────────────────────────────────────────

-- Maintenance / investigation lookup: all historical slugs for a given event.
CREATE INDEX IF NOT EXISTS event_slug_history_event_id_idx
  ON public.event_slug_history (event_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Internal-only, same model as venue_slug_history / audit_logs: no anon or
-- authenticated policies. All reads/writes go through createAdminClient()
-- (service-role), matching how the rest of the event data layer already
-- operates (src/lib/data/events.ts, src/lib/eventSlug.ts).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.event_slug_history ENABLE ROW LEVEL SECURITY;

-- No permissive policies — service-role bypasses RLS and is the only
-- intended caller today (a future public route lookup, and any future
-- slug-change admin action, would run server-side via createAdminClient()).
-- Add a scoped `authenticated` policy later only if/when a Control Panel
-- slug-management workflow needs direct client-side access instead of going
-- through a server action.


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs (required — see migration 039_security_hardening.sql + CLAUDE.md)
-- Internal-only: service_role only. No anon/authenticated grants — this
-- table is never read by a public-facing intake form and never written to
-- directly by the operator or consumer apps.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.event_slug_history TO service_role;
