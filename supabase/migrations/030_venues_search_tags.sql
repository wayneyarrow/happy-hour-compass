-- =============================================================================
-- Migration: 030_venues_search_tags.sql
--
-- Adds search_tags TEXT[] to the venues table.
-- Search tags power consumer keyword discovery and the future Discover Page.
--
-- Design decisions:
--   - TEXT[] column on venues (not a join table): tag catalog is controlled,
--     tag counts are small, and queries are simple array-containment checks.
--   - DEFAULT '{}' backfills all existing rows with an empty array.
--   - No DB-level constraint on tag values — the application layer enforces
--     the controlled catalog (src/lib/searchTags.ts) and plan limits.
--   - Free-plan operators receive 0 tags (enforced in server actions, not DB).
--     Seeded/CSV-imported venues start with no tags; tags are a paid feature.
--
-- Future Discover Page:
--   SELECT * FROM venues WHERE 'Patio' = ANY(search_tags) ...
-- =============================================================================

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS search_tags TEXT[] NOT NULL DEFAULT '{}';
