-- =============================================================================
-- Migration 065: Venue Slug History
--
-- Durable, additive infrastructure for preserving retired public venue
-- slugs, so a FUTURE redirect flow can resolve an old
-- /{market}/{city}/{old-slug} URL to a venue's current canonical URL after
-- its slug changes.
--
-- This migration is infrastructure only:
--   - No existing venue is modified. venues.slug values are untouched.
--   - No history rows are inserted — this table is empty after migration.
--   - No route/lookup/redirect behaviour changes (src/app/(website)/[market]/
--     [city]/[slug]/page.tsx and the legacy [market]/venue/[slug]/page.tsx
--     stub are not touched by this migration).
--   - venues.slug remains TEXT UNIQUE NOT NULL, globally unique, unchanged.
--
-- Resolution flow this table will support (NOT implemented by this
-- migration — a later task wires the actual route lookup):
--   incoming old slug
--     -> SELECT venue_id FROM venue_slug_history WHERE old_slug = :slug
--     -> SELECT current slug/market_id/city_id FROM venues WHERE id = venue_id
--     -> resolve current market/city slugs via markets/cities
--     -> permanent redirect to the venue's CURRENT canonical URL
--
-- History resolves to venue_id, never to a "new_slug" column — this is
-- deliberate. If a venue's slug changes more than once, every historical
-- slug redirects straight to whatever the venue's LIVE slug is at request
-- time, with no chained old-to-new lookups to walk.
--
-- Design decisions:
--   - Modeled directly on audit_logs (migration 041_audit_logs.sql), the
--     closest existing history/audit-table pattern in this repo:
--     append-only, RLS enabled with no permissive policies, service-role
--     only via GRANT ALL, no updated_at column or trigger (history rows are
--     written once and never updated).
--   - venue_id ON DELETE CASCADE: a history row for a venue that no longer
--     exists cannot resolve to a "current canonical URL" (there isn't one),
--     so retaining it would be a dead, unusable foreign key. This also
--     matches how every other venue-scoped child table in this schema
--     handles deletion (events, media, claims, discover_rail_overrides,
--     operator_impersonation_sessions, all four analytics event tables,
--     content_guide_venues, homepage_sections' venue_id) — CASCADE is the
--     established convention for "this row has no meaning without its
--     venue," not an exception. (Venues are otherwise soft-managed via
--     is_published / cancelled_at; the one hard DELETE FROM venues in the
--     app today — control-panel/operator-submissions/[id]/actions.ts,
--     rollback of a just-created venue when operator provisioning fails
--     immediately after — deletes a venue that is only seconds old and so
--     could never have accumulated a history row anyway.)
--   - old_slug is TEXT NOT NULL and globally UNIQUE — the same scope as the
--     live venues.slug constraint it complements, and the only way to
--     guarantee one historical alias can never be claimed by two venues.
--     Normalization (lowercase/hyphenated, matching src/lib/slugify.ts's
--     output) is an application-layer responsibility at write time, same as
--     it is for venues.slug today — no CHECK constraint is added here,
--     matching the precedent that venues.slug/content_guides.slug/
--     collections.slug also have no format-level CHECK.
--   - No trigger auto-populates this table on venues.slug UPDATE. Per this
--     task's scope, the eventual controlled backfill will INSERT the
--     history row and UPDATE venues.slug together in one explicit
--     transaction; a later, separate task may introduce a deliberate
--     application-level capture step for ad hoc slug changes. Adding a
--     trigger now would introduce hidden slug-mutation-adjacent behaviour
--     this task is explicitly scoped to avoid.
--
--   KNOWN LIMITATION (documented, not enforced by a constraint or trigger):
--     No ordinary constraint can span venues.slug and
--     venue_slug_history.old_slug together, so cross-table collision safety
--     for a slug change is entirely the future writer's responsibility.
--     Note that a naive "old_slug must not currently exist in venues.slug"
--     check is WRONG on its own: at the start of a normal rename, the old
--     slug still belongs to the very venue being renamed — that is what
--     makes it "old." Before performing any future slug change, the writer
--     must instead verify all of the following:
--       1. The old slug being retired does not currently belong to any
--          OTHER venue (i.e. if it exists in venues.slug at all, it must
--          belong to exactly this venue_id, since it normally still does
--          right up until the UPDATE below).
--       2. The new slug being written to venues.slug does not already
--          belong to a different venue (venues.slug's own UNIQUE
--          constraint enforces this at the database level, but the writer
--          should check it defensively before attempting the UPDATE).
--       3. The new slug does not already exist as a historical alias for
--          any venue in venue_slug_history.old_slug — nothing in this
--          schema enforces that; it must be checked at the application
--          layer.
--       4. The INSERT into venue_slug_history and the UPDATE of
--          venues.slug must happen inside the same transaction, so a
--          failure partway through never leaves an orphaned history row
--          with no corresponding rename, or a renamed venue with no
--          history row.
--     A cross-table trigger could enforce some of this automatically, but
--     that would be exactly the "complex trigger behaviour" this migration
--     is scoped to avoid — see the Design decisions section above.
--
-- Rollback (manual, not embedded — no migration in this repo carries an
-- embedded rollback block; describing it here instead):
--   DROP TABLE IF EXISTS public.venue_slug_history;
--   (Safe at any point before this migration: the table starts and stays
--   empty until a future task populates it.)
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: venue_slug_history
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_slug_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID        NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  old_slug    TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT venue_slug_history_old_slug_unique UNIQUE (old_slug)
);

COMMENT ON TABLE public.venue_slug_history IS
  'Append-only record of a venue''s retired public slugs. Resolves an old '
  'slug to venue_id only, never a chained old-to-new slug mapping, so the '
  'venue''s CURRENT market/city/slug (read live from venues at redirect '
  'time) is always the correct target regardless of how many times the '
  'slug has changed since. Empty until a future backfill/redirect task '
  'populates it — see migration 065 header for full design notes.';

COMMENT ON COLUMN public.venue_slug_history.venue_id IS
  'The venue this slug used to identify. ON DELETE CASCADE: a history row '
  'for a deleted venue has no current canonical URL to redirect to, so it '
  'is not retained as a dead reference — matches this schema''s existing '
  'convention for venue-scoped child tables (events, media, claims, etc).';

COMMENT ON COLUMN public.venue_slug_history.old_slug IS
  'A retired venue slug, expected in the same lowercase/hyphenated form as '
  'venues.slug (see src/lib/slugify.ts). Globally unique across this table '
  'so one historical alias can never be claimed by two venues. NOT '
  'enforced here: at insert time this venue''s OWN row in venues.slug will '
  'normally still equal old_slug (that is what makes it "old"); the '
  'cross-table checks a future writer must run before changing a slug are '
  'documented in the migration header, not a simple "must not exist in '
  'venues" rule.';

COMMENT ON COLUMN public.venue_slug_history.created_at IS
  'When this slug was retired, i.e. when venues.slug was changed away from '
  'this value.';


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
--
-- old_slug already has a unique btree index from the UNIQUE constraint
-- above — that alone serves the primary expected lookup
-- (old_slug = incoming route slug); no separate index is added for it.
-- ─────────────────────────────────────────────────────────────────────────────

-- Maintenance / investigation lookup: all historical slugs for a given venue.
CREATE INDEX IF NOT EXISTS venue_slug_history_venue_id_idx
  ON public.venue_slug_history (venue_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Internal-only, same model as audit_logs (migration 041): no anon or
-- authenticated policies. All reads/writes go through createAdminClient()
-- (service-role), matching how the rest of the venue/geography data layer
-- already operates (src/lib/data/venues.ts, src/lib/geo/geography.ts).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.venue_slug_history ENABLE ROW LEVEL SECURITY;

-- No permissive policies — service-role bypasses RLS and is the only
-- intended caller today (public route lookup, and any future backfill or
-- Control Panel admin action, all run server-side via createAdminClient()).
-- Add a scoped `authenticated` policy later only if/when a Control Panel
-- slug-management workflow needs direct client-side access instead of going
-- through a server action.


-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTs (required — see migration 039_security_hardening.sql + CLAUDE.md)
-- Internal-only: service_role only. No anon/authenticated grants — this
-- table is never read by a public-facing intake form and never written to
-- directly by the operator or consumer apps.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT ALL ON public.venue_slug_history TO service_role;
