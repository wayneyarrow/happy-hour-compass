-- =============================================================================
-- Migration 107: Normalize submission-* Venue Slugs (Backfill)
--
-- Replaces the machine-generated public slugs of four operator-submission
-- venues created by founder approval before ba27706 ("fix(venues): generate
-- clean slugs for approved submissions"). approveAndCreateVenueAction used to
-- build slugs as submission-{placeId|submissionId}; it now derives them from
-- the venue name (src/lib/venueSlug.ts), so this is a one-time cleanup of the
-- existing rows only.
--
-- Same shape as 066_venue_slug_normalization.sql: every retired slug is
-- written to venue_slug_history BEFORE the venue's slug is updated, so the
-- existing historical-slug route ((website)/[market]/[city]/[slug]/page.tsx →
-- getVenueByHistoricalSlug) 308-redirects each old public URL to the venue's
-- new canonical URL. Sitemap, canonical tags and JSON-LD @ids follow the
-- current slug automatically.
--
-- Pure data (DML): no CREATE/ALTER, so no GRANT block (existing grants on
-- public.venues and public.venue_slug_history apply).
--
-- MAPPING (4 venues — explicit, approved; nothing else is read or written):
--   SpearHead Winery                     (published)
--     submission-862e41f4-f577-402f-8876-49d73e146fae -> spearhead-winery
--   Perch Sky Lounge                     (published)
--     submission-d84fc8a5-7dea-4a0b-848d-e6148799ed34 -> perch-sky-lounge
--   The Placery at Hyatt Place Kelowna   (published)
--     submission-6de945ea-a3b7-4283-bc0d-e84061df871f -> the-placery-at-hyatt-place
--   Table 19 at The Okanagan Golf Club   (unpublished — history kept anyway)
--     submission-7a656428-2b37-4e66-85a4-41235323da12 -> table-19-okanagan-golf-club
--     (hand-curated; the name-based helper would produce
--      table-19-at-the-okanagan-golf-club for a NEW venue — intentional.)
--
-- Explicitly excluded:
--   The Alder Room Test (114d4c6d-beb4-411d-8d78-dabcbdfcb480) — test data,
--   slug unchanged, no history row.
--   Events — The Placery's unpublished event keeps its existing slug; no
--   events / event_slug_history rows are touched.
--
-- Per-venue guards (before any write for that row), as in 066 plus two:
--   0. old_slug <> new_slug, and new_slug is not a reserved venue slug.
--   1. Venue exists; has market_id + city_id (canonical route needs both).
--   2. new_slug does not belong to a DIFFERENT venue.
--   3. new_slug is not a retired slug in venue_slug_history (any venue) —
--      a rename must never land on an existing redirect URL.        [new]
--   4. Branch on the CURRENT slug:
--        = new_slug -> already done: the old_slug history row MUST exist for
--                      this venue, else abort; then no-op.
--        = old_slug -> history row for old_slug owned by another venue →
--                      abort; owned by this venue → don't duplicate; else
--                      insert. Then UPDATE venues.slug.
--        anything else -> abort (stale/unexpected state; never guess).
--   After the loop: assert all four venues are at new_slug with their
--   old_slug history row.                                             [new]
--
-- Any failure raises, aborting the whole file — Supabase applies each
-- migration file in one transaction, so history inserts and slug updates
-- succeed or fail together; there is never a partial rename.
--
-- RE-RUN: a second run finds each venue already at new_slug with correct
-- history and no-ops (no duplicate history, no second rename). Any other
-- state aborts.
--
-- SIDE EFFECT: the venues_updated_at BEFORE UPDATE trigger bumps
-- venues.updated_at on the four renamed rows (sitemap lastmod moves too).
-- Not suppressed. No other venue column is written.
-- =============================================================================

DO $$
DECLARE
  m RECORD;
  v_current_slug   TEXT;
  v_market_id      UUID;
  v_city_id        UUID;
  v_collision_id   UUID;
  v_history_owner  UUID;
  v_history_found  BOOLEAN;
  v_done           INTEGER;
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('1c68334e-992b-4101-bf5e-4f2bce4c2746'::uuid, 'submission-862e41f4-f577-402f-8876-49d73e146fae', 'spearhead-winery'),
      ('5cf79e21-f055-4647-9b1f-94b8d42469f6'::uuid, 'submission-d84fc8a5-7dea-4a0b-848d-e6148799ed34', 'perch-sky-lounge'),
      ('fe324b1e-12cf-4ce6-ac28-2370f2c3e126'::uuid, 'submission-6de945ea-a3b7-4283-bc0d-e84061df871f', 'the-placery-at-hyatt-place'),
      ('c7021e0a-a13b-4430-9445-08f51b9efca5'::uuid, 'submission-7a656428-2b37-4e66-85a4-41235323da12', 'table-19-okanagan-golf-club')
    ) AS mapping(venue_id, old_slug, new_slug)
  LOOP
    -- Guard 0: mapping sanity.
    IF m.old_slug = m.new_slug THEN
      RAISE EXCEPTION 'submission_venue_slugs: mapping row for venue % has old_slug = new_slug (%)', m.venue_id, m.old_slug;
    END IF;
    IF m.new_slug IN ('events') THEN  -- mirrors RESERVED_VENUE_SLUGS (src/lib/slugify.ts)
      RAISE EXCEPTION 'submission_venue_slugs: new slug % is reserved', m.new_slug;
    END IF;

    -- Guard 1: venue exists with a canonical geography.
    SELECT slug, market_id, city_id
      INTO v_current_slug, v_market_id, v_city_id
      FROM public.venues
      WHERE id = m.venue_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submission_venue_slugs: venue % not found (expected old slug %)', m.venue_id, m.old_slug;
    END IF;

    IF v_market_id IS NULL OR v_city_id IS NULL THEN
      RAISE EXCEPTION 'submission_venue_slugs: venue % (slug %) has no market_id/city_id — cannot produce a canonical URL',
        m.venue_id, v_current_slug;
    END IF;

    -- Guard 2: destination slug not owned by another venue.
    SELECT id INTO v_collision_id
      FROM public.venues
      WHERE slug = m.new_slug AND id <> m.venue_id;

    IF FOUND THEN
      RAISE EXCEPTION 'submission_venue_slugs: new slug % already belongs to venue % (renaming %)',
        m.new_slug, v_collision_id, m.venue_id;
    END IF;

    -- Guard 3: destination slug is not an existing retired slug.
    SELECT venue_id INTO v_collision_id
      FROM public.venue_slug_history
      WHERE old_slug = m.new_slug;

    IF FOUND THEN
      RAISE EXCEPTION 'submission_venue_slugs: new slug % is already a retired slug in venue_slug_history (venue %)',
        m.new_slug, v_collision_id;
    END IF;

    -- Shared lookup: existing history row for this old_slug, if any.
    SELECT venue_id INTO v_history_owner
      FROM public.venue_slug_history
      WHERE old_slug = m.old_slug;
    v_history_found := FOUND;

    IF v_current_slug = m.new_slug THEN
      -- Already renamed — only acceptable if the retirement is recorded for
      -- this exact venue.
      IF NOT v_history_found THEN
        RAISE EXCEPTION 'submission_venue_slugs: venue % is already at new slug % but has NO venue_slug_history row for retired slug %',
          m.venue_id, m.new_slug, m.old_slug;
      END IF;

      IF v_history_owner <> m.venue_id THEN
        RAISE EXCEPTION 'submission_venue_slugs: venue % is at new slug % but retired slug % is recorded for a DIFFERENT venue %',
          m.venue_id, m.new_slug, m.old_slug, v_history_owner;
      END IF;

      CONTINUE;  -- verified complete; no insert, no update.

    ELSIF v_current_slug = m.old_slug THEN
      IF v_history_found AND v_history_owner <> m.venue_id THEN
        RAISE EXCEPTION 'submission_venue_slugs: old slug % is already retired for a different venue % (expected %)',
          m.old_slug, v_history_owner, m.venue_id;
      END IF;

      IF NOT v_history_found THEN
        INSERT INTO public.venue_slug_history (venue_id, old_slug)
        VALUES (m.venue_id, m.old_slug);
      END IF;

      UPDATE public.venues
        SET slug = m.new_slug
        WHERE id = m.venue_id;

    ELSE
      RAISE EXCEPTION 'submission_venue_slugs: venue % has slug % but expected % (old) or % (new)',
        m.venue_id, v_current_slug, m.old_slug, m.new_slug;
    END IF;
  END LOOP;

  -- Final assertion: all four venues at their new slug, each with its
  -- old_slug retired to that same venue.
  SELECT count(*) INTO v_done
    FROM (VALUES
      ('1c68334e-992b-4101-bf5e-4f2bce4c2746'::uuid, 'submission-862e41f4-f577-402f-8876-49d73e146fae', 'spearhead-winery'),
      ('5cf79e21-f055-4647-9b1f-94b8d42469f6'::uuid, 'submission-d84fc8a5-7dea-4a0b-848d-e6148799ed34', 'perch-sky-lounge'),
      ('fe324b1e-12cf-4ce6-ac28-2370f2c3e126'::uuid, 'submission-6de945ea-a3b7-4283-bc0d-e84061df871f', 'the-placery-at-hyatt-place'),
      ('c7021e0a-a13b-4430-9445-08f51b9efca5'::uuid, 'submission-7a656428-2b37-4e66-85a4-41235323da12', 'table-19-okanagan-golf-club')
    ) AS mapping(venue_id, old_slug, new_slug)
    JOIN public.venues v ON v.id = mapping.venue_id AND v.slug = mapping.new_slug
    JOIN public.venue_slug_history h ON h.old_slug = mapping.old_slug AND h.venue_id = mapping.venue_id;

  IF v_done <> 4 THEN
    RAISE EXCEPTION 'submission_venue_slugs: post-condition failed — expected 4 venues renamed with history, found %', v_done;
  END IF;
END $$;
