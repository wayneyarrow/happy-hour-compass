-- =============================================================================
-- Migration 066: Venue Slug Normalization (Backfill)
--
-- Applies the COMPLETE approved venue slug normalization: 62 venues total,
-- removing redundant city prefixes now that the canonical public venue URL
-- is /{market}/{city}/{venue-slug} (see (website)/[market]/[city]/[slug]/
-- page.tsx and docs/website/WEBSITE_PRODUCT_PLAYBOOK.md's Geographic
-- Information Architecture) — the city is already in the URL path, so
-- repeating it inside the slug itself is redundant.
--
-- This migration is pure data (DML), not schema (DDL): no CREATE TABLE, no
-- ALTER TABLE, no new columns. No GRANT block is added — nothing here
-- changes access to public.venues (existing grants apply) or
-- public.venue_slug_history (already fully granted to service_role only,
-- migration 065_venue_slug_history.sql).
--
-- Every retired slug is written to venue_slug_history BEFORE the venue's
-- slug is updated, so the historical-slug redirect route (already
-- implemented and committed — see (website)/[market]/[city]/[slug]/
-- page.tsx's getVenueByHistoricalSlug fallback) resolves every one of these
-- old URLs to the venue's new canonical URL with a 308 permanent redirect.
--
-- PROVENANCE: this mapping was produced by a read-only Supabase audit
-- (SELECT-only, no writes) of every venue whose slug begins with its own
-- relational city slug — 64 candidates found across the full venues table.
-- Of those 64:
--   - 60 were classified "safe automatic normalization" (straight
--     city-prefix removal; several already retain a branch/neighbourhood
--     qualifier afterward, e.g. dunnenzies-mission, kelly-obryans-downtown,
--     cactus-club-yacht-club, wings-rutland — those qualifiers are
--     untouched, only the redundant city prefix is stripped).
--   - 2 were flagged "must retain a location qualifier": Original Joe's has
--     two Central Okanagan locations that would otherwise both normalize to
--     the same "original-joes", so the city is kept as a SUFFIX instead of
--     removed entirely.
--   - 1 was flagged "needs human review": Port Moody Legion Club 119's slug
--     repeats "port-moody" twice (once as the auto-detected prefix, again
--     later from the original CSV-import address suffix) — the finalized
--     slug drops both the prefix and the trailing street-address fragment.
--   - 1 ("Unable to determine" — the Calgary placeholder venue) and 1 (The
--     Lantern & Oak, from the "safe automatic" bucket) were excluded
--     entirely as test/placeholder data — no slug change, no history row.
--
-- Of the 60 "safe automatic" candidates minus the 1 excluded test venue
-- (Lantern & Oak) = 59 automatic changes, one of which (19 Okanagan Grill +
-- Bar) required a finalized manual correction beyond the audit's own naive
-- proposal: the audit derived "19-greens" from the venue's OLD slug
-- fragment, not realizing the business had been renamed — the finalized
-- slug instead reflects the venue's CURRENT name.
--
-- Total approved: 59 automatic (58 exactly as audited + 1 corrected, 19
-- Okanagan Grill + Bar) + 2 Original Joe's (finalized) + 1 Port Moody Legion
-- (finalized) = 62 venues, enumerated explicitly in the mapping below.
--
-- Finalized special-case outcomes (do not shorten or otherwise alter):
--   kelowna-bna-brewing                                    -> bna-brewing
--   kelowna-original-joes                                  -> original-joes-kelowna
--   west-kelowna-original-joes                             -> original-joes-west-kelowna
--   west-kelowna-19-greens                                 -> 19-okanagan-grill-bar
--   port-moody-legion-club-119-port-moody-2529-clarke-st   -> legion-club-119
--
-- Explicitly excluded (test data — no slug change, no history row):
--   The Lantern & Oak              (kelowna-wayne-s-cafe)
--   Calgary placeholder/test venue (calgary-calgary)
--
-- Every other venue in the table (hundreds of rows from the CSV import,
-- most with a different, longer slug pattern and no assigned market/city)
-- is untouched — this migration only ever reads or writes the 62 specific
-- venue_id values named in the mapping below.
--
-- RE-ENTRY NOTE: 10 of these 62 venues were already renamed directly against
-- the live database via the service-role connection (Supabase CLI
-- authentication was unavailable — SUPABASE_ACCESS_TOKEN in .env.local is a
-- placeholder, not a real personal access token) before this migration file
-- was expanded to its full, complete form. Those 10 rows are included here
-- like every other mapping row; the per-venue logic below verifies each one
-- is correctly already-renamed (slug AND history both confirmed) rather
-- than special-casing them, so this single migration is safely re-runnable
-- regardless of which subset has already been applied by any means.
--
-- Per-venue logic (every row in the mapping, before any write for that row):
--   0. old_slug must never equal new_slug (static sanity guard against a
--      mapping mistake).
--   1. The venue_id must exist in public.venues.
--   2. The venue must have a non-null market_id and city_id — required for
--      the canonical /{market}/{city}/{slug} route to resolve at all.
--   3. new_slug must not already belong to a DIFFERENT venue.
--   4. Branch on the venue's CURRENT slug:
--
--        current slug = new_slug (already renamed, by this migration or
--        directly)
--          -> being at the new slug ALONE is never sufficient. The matching
--             venue_slug_history row for old_slug MUST exist and MUST point
--             to this exact venue_id, or the migration raises an exception
--             and aborts — a bare slug match can't distinguish "correctly
--             migrated" from "renamed by some other, unrecorded means,"
--             and this migration must never silently accept the latter.
--             Only once the history row is confirmed correct does the row
--             safely no-op (no insert, no update).
--
--        current slug = old_slug (not yet renamed)
--          -> if a venue_slug_history row for old_slug already exists for a
--             DIFFERENT venue, raise an exception (conflicting retirement).
--             If it already exists for THIS venue, skip the insert (already
--             recorded, do not duplicate). Otherwise insert it. Then update
--             venues.slug to new_slug.
--
--        anything else
--          -> unexpected state; raise an exception and abort rather than
--             guess.
--
-- Any invariant failure raises an exception, aborting the entire DO block —
-- and with it this whole migration file, since Supabase applies each
-- migration file as a single transaction (same implicit-transaction
-- reliance as 064_collection_public_slug.sql's backfill + assertion
-- stages) — so history inserts and slug updates always succeed or fail
-- together, and a failure partway through never leaves a partial rename.
--
-- NOTE ON LIVE APPLICATION VIA THE SERVICE-ROLE CONNECTION: when this exact
-- guarded logic is executed venue-by-venue through the service-role REST
-- connection (the only available path while Supabase CLI/MCP authentication
-- remains blocked), there is no single database transaction spanning all 62
-- rows — PostgREST does not expose multi-statement transactions. Each
-- venue's history-insert + slug-update pair is instead its own tightly
-- coupled unit (the update is only issued after its own insert succeeds,
-- and a failed update triggers an explicit compensating delete of the
-- history row just inserted), so a failure on one venue cannot corrupt
-- another venue's already-committed state, but the 62-row operation as a
-- whole is not atomic in the single-transaction sense this SQL file has
-- when actually run through Supabase's migration runner.
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
BEGIN
  FOR m IN
    SELECT * FROM (VALUES
      ('f4037471-4be4-40a4-a5fb-3164d8067714'::uuid, 'kelowna-bernies-supper-club',                            'bernies-supper-club'),
      ('d6805f50-f50f-4165-a11a-bda61990dfbf'::uuid, 'kelowna-black-hole',                                     'black-hole'),
      ('b139f8c5-86ae-405e-a700-e0ff609f1c95'::uuid, 'kelowna-bna-brewing',                                    'bna-brewing'),
      ('eaf84fac-b3bf-46fd-9eba-60c3de9775b7'::uuid, 'kelowna-browns-social-house',                            'browns-social-house'),
      ('31a820c7-89b6-4719-89cf-f471e0ea44b5'::uuid, 'kelowna-bts-cocktail-bar-kitchen',                       'bts-cocktail-bar-kitchen'),
      ('e404c81e-7edc-42e3-a246-e379775f0bef'::uuid, 'kelowna-cactus-club-banks-road',                         'cactus-club-banks-road'),
      ('ff74a3ef-cec2-45de-b148-5f865224baf9'::uuid, 'kelowna-cactus-club-yacht-club',                         'cactus-club-yacht-club'),
      ('e5637025-1da2-41e9-906f-2373244f052e'::uuid, 'kelowna-central-kitchen-bar',                            'central-kitchen-bar'),
      ('45b79003-d9c6-4064-83ae-daa6b8ba4b1e'::uuid, 'kelowna-da-good-bar',                                    'da-good-bar'),
      ('f98077f6-fc20-4460-ac65-9e638c3f8dac'::uuid, 'kelowna-dunnenzies-mission',                             'dunnenzies-mission'),
      ('dfc606e3-18b5-4d38-98f9-0e9faaf7e819'::uuid, 'kelowna-earls-kitchen-bar',                              'earls-kitchen-bar'),
      ('69ad9bd0-efff-4061-ab81-7126681e4098'::uuid, 'kelowna-ether-bar',                                      'ether-bar'),
      ('3bb09154-ddff-4fe2-9d2a-6111100af47b'::uuid, 'kelowna-fakers-bar-and-grill',                           'fakers-bar-and-grill'),
      ('8e0cb893-a035-4348-8340-ffd415492dbd'::uuid, 'kelowna-fancy-s-cold-cuts-cocktails',                    'fancy-s-cold-cuts-cocktails'),
      ('6e0e4c98-85b7-4302-813f-31f5687f8626'::uuid, 'kelowna-gulfstream',                                     'gulfstream'),
      ('d4f30808-d4c2-4a66-a72b-438c2c4ae047'::uuid, 'kelowna-hotel-eldorado',                                 'hotel-eldorado'),
      ('dd6a3f12-bb78-4d9b-8b9f-9f5485b1ba34'::uuid, 'kelowna-hugos-mexican-kitchen',                          'hugos-mexican-kitchen'),
      ('4994e062-47d7-4d07-a1a1-b3a9885fa7dc'::uuid, 'kelowna-joey',                                           'joey'),
      ('f3e9bfd4-603b-4b0e-b5f6-73d535423776'::uuid, 'kelowna-kelly-obryans-downtown',                         'kelly-obryans-downtown'),
      ('efbbbaf5-e5c3-4b58-979b-143874195fa0'::uuid, 'kelowna-kettle-river-brewing',                           'kettle-river-brewing'),
      ('804a0cf0-9f29-4117-a036-62a608a6a4b4'::uuid, 'kelowna-king-taps-lakeside',                             'king-taps-lakeside'),
      ('ae8e6bcc-7e76-439d-b44a-7ee575a6c4ba'::uuid, 'kelowna-labrador-cafe',                                  'labrador-cafe'),
      ('c0f99899-6529-4f09-be62-f49ab1183875'::uuid, 'kelowna-laneway-canteen',                                'laneway-canteen'),
      ('ff07d79b-2e77-4734-96e0-985c7f500e41'::uuid, 'kelowna-leopolds-tavern',                                'leopolds-tavern'),
      ('66da1c93-8a2a-4f51-836e-471a6b554a9f'::uuid, 'kelowna-micro-bar-bites',                                'micro-bar-bites'),
      ('14ff58ec-5ad7-4565-8e46-d45f37db4187'::uuid, 'kelowna-mid-town-station',                               'mid-town-station'),
      ('8c07d7fc-0f7b-4e32-af93-14e5668df47b'::uuid, 'kelowna-moxies',                                         'moxies'),
      ('eca743b6-0baf-4c5c-9a0f-14b042ca8a53'::uuid, 'kelowna-not-a-real-bar',                                 'not-a-real-bar'),
      ('5891dbe5-c3d9-4f4c-8a86-db49d8c71779'::uuid, 'kelowna-oflannigans-pub',                                'oflannigans-pub'),
      ('804561ce-2669-4944-a249-9d3916268b35'::uuid, 'kelowna-oak-cru',                                        'oak-cru'),
      ('108bc168-9138-43a7-b463-5af6e7025438'::uuid, 'kelowna-original-joes',                                  'original-joes-kelowna'),
      ('d5bcafe8-178c-4a67-a589-881817e20c39'::uuid, 'kelowna-packing-house-pub',                              'packing-house-pub'),
      ('4590d6e9-b0fe-4431-9924-2435a2c4b1b1'::uuid, 'kelowna-pretty-not-bad',                                 'pretty-not-bad'),
      ('98fbba65-8157-4490-b8b9-a476c3f22cd6'::uuid, 'kelowna-rustic-reel-brewing-company',                    'rustic-reel-brewing-company'),
      ('7ca63d5e-6513-4d4b-a7a4-c9f03df98480'::uuid, 'kelowna-shore-line-brewing',                             'shore-line-brewing'),
      ('36b11b19-f993-4062-9db8-2b39554a2aed'::uuid, 'kelowna-silly-bar',                                      'silly-bar'),
      ('efb0104f-1304-48aa-9219-535105fdb2d5'::uuid, 'kelowna-skinny-dukes',                                   'skinny-dukes'),
      ('b158f787-3ef7-498e-be58-b4f01cbc08a1'::uuid, 'kelowna-canadian-brewhouse',                             'canadian-brewhouse'),
      ('7086f56b-98f4-4597-9894-81160c7c5b9c'::uuid, 'kelowna-the-keg',                                        'the-keg'),
      ('312fb60d-9ee1-4fbd-8638-649253606e57'::uuid, 'kelowna-the-office-brewery',                             'the-office-brewery'),
      ('912fdb26-c912-4eef-8c75-49dc1ace6c9e'::uuid, 'kelowna-train-station-pub',                              'train-station-pub'),
      ('accd7e52-21e0-4ca3-932d-5fa738debebc'::uuid, 'kelowna-wayne-test-bar',                                 'wayne-test-bar'),
      ('b32bee97-4631-4ebc-9956-a6716f4f053d'::uuid, 'kelowna-weirdo-bar',                                     'weirdo-bar'),
      ('17ce7ff5-cd76-4a9f-8ac6-95b36ea061f2'::uuid, 'kelowna-wildling',                                       'wildling'),
      ('ccc4c410-7ce1-4c2c-bfa0-a8ed132c70e4'::uuid, 'kelowna-wings-rutland',                                  'wings-rutland'),
      ('917e2377-d6f5-4fe0-b0bc-67db26d902be'::uuid, 'kelowna-ye-old-faker',                                   'ye-old-faker'),
      ('f9de0bfd-f17b-4260-8e80-a7a1fcc84313'::uuid, 'lake-country-block-one',                                 'block-one'),
      ('fef218bb-62e5-4ae1-93a7-95496d1f4b1e'::uuid, 'lake-country-britannia-brewing',                         'britannia-brewing'),
      ('1d50aa31-c50a-4504-923e-456635b86c62'::uuid, 'lake-country-garden-bistro-peak-cellars',                'garden-bistro-peak-cellars'),
      ('c35ffbda-d22c-4971-86d5-573baabff45b'::uuid, 'lake-country-turtle-bay-pub',                            'turtle-bay-pub'),
      ('3d33c21a-82fd-4d36-b4f4-6cdf3464876e'::uuid, 'lake-country-woodys-pub',                                'woodys-pub'),
      ('7cbe0b53-d746-439a-93fc-23492326711c'::uuid, 'port-moody-legion-club-119-port-moody-2529-clarke-st',  'legion-club-119'),
      ('bcf79aee-a35b-4ce2-95de-834605d39e3a'::uuid, 'vancouver-east-side-craft-house',                        'east-side-craft-house'),
      ('2610d8e0-e9e0-4e54-b5ac-ad62349b40af'::uuid, 'vancouver-published-on-main',                            'published-on-main'),
      ('03321fb2-183a-4b3d-9a9e-4b22ac1c45d4'::uuid, 'vancouver-the-wolf-and-hound',                           'the-wolf-and-hound'),
      ('ebfb9747-4b94-4210-b210-2978668130fe'::uuid, 'west-kelowna-19-greens',                                 '19-okanagan-grill-bar'),
      ('3084ce28-9af4-41d1-9a73-1c27550e11e3'::uuid, 'west-kelowna-kelly-obryans',                             'kelly-obryans'),
      ('58cd3c76-f9a7-4c6c-aa96-126175061ba2'::uuid, 'west-kelowna-original-joes',                             'original-joes-west-kelowna'),
      ('9ad843d1-164b-4ba8-9584-27218fc0033b'::uuid, 'west-kelowna-quails-gate',                               'quails-gate'),
      ('ffb9f1a9-f49b-4880-8676-26d84e5fcf5b'::uuid, 'west-kelowna-hatching-post',                             'hatching-post'),
      ('8ce34e82-0e9a-4976-8107-472864a549bc'::uuid, 'west-kelowna-landing-kitchen-bar',                       'landing-kitchen-bar'),
      ('5df83b8c-e608-4597-9f9b-b9795d869bcc'::uuid, 'west-kelowna-modest-butcher',                            'modest-butcher')
    ) AS mapping(venue_id, old_slug, new_slug)
  LOOP
    -- Guard 0: a mapping row must never be a no-op rename.
    IF m.old_slug = m.new_slug THEN
      RAISE EXCEPTION 'venue_slug_normalization: mapping row for venue % has old_slug = new_slug (%)', m.venue_id, m.old_slug;
    END IF;

    -- Invariant 1: venue must exist. Also captures current state for the
    -- checks below.
    SELECT slug, market_id, city_id
      INTO v_current_slug, v_market_id, v_city_id
      FROM public.venues
      WHERE id = m.venue_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'venue_slug_normalization: venue % not found (expected old slug %)', m.venue_id, m.old_slug;
    END IF;

    -- Invariant 2: canonical route requires a resolved market + city.
    IF v_market_id IS NULL OR v_city_id IS NULL THEN
      RAISE EXCEPTION 'venue_slug_normalization: venue % (slug %) has no market_id/city_id — cannot produce a canonical URL',
        m.venue_id, v_current_slug;
    END IF;

    -- Invariant 3: destination slug must not already belong to another venue.
    SELECT id INTO v_collision_id
      FROM public.venues
      WHERE slug = m.new_slug AND id <> m.venue_id;

    IF FOUND THEN
      RAISE EXCEPTION 'venue_slug_normalization: new slug % already belongs to venue % (renaming %)',
        m.new_slug, v_collision_id, m.venue_id;
    END IF;

    -- Shared lookup: any existing history row for this old_slug, used by
    -- both branches below.
    SELECT venue_id INTO v_history_owner
      FROM public.venue_slug_history
      WHERE old_slug = m.old_slug;
    v_history_found := FOUND;

    IF v_current_slug = m.new_slug THEN
      -- Already renamed (by this migration on a prior run, or directly).
      -- Being at the new slug ALONE is not sufficient — verify the
      -- retirement is actually recorded and correct before treating this
      -- row as complete.
      IF NOT v_history_found THEN
        RAISE EXCEPTION 'venue_slug_normalization: venue % is already at new slug % but has NO venue_slug_history row for retired slug % — cannot verify this rename is complete',
          m.venue_id, m.new_slug, m.old_slug;
      END IF;

      IF v_history_owner <> m.venue_id THEN
        RAISE EXCEPTION 'venue_slug_normalization: venue % is at new slug % but retired slug % is recorded in history for a DIFFERENT venue % — data integrity conflict',
          m.venue_id, m.new_slug, m.old_slug, v_history_owner;
      END IF;

      -- History confirmed correct — safe no-op. No insert, no update.
      CONTINUE;

    ELSIF v_current_slug = m.old_slug THEN
      -- Not yet renamed — normal path.
      IF v_history_found AND v_history_owner <> m.venue_id THEN
        RAISE EXCEPTION 'venue_slug_normalization: old slug % is already retired in history for a different venue % (expected %)',
          m.old_slug, v_history_owner, m.venue_id;
      END IF;

      IF NOT v_history_found THEN
        INSERT INTO public.venue_slug_history (venue_id, old_slug)
        VALUES (m.venue_id, m.old_slug);
      END IF;
      -- else: already recorded for this exact venue — do not duplicate.

      UPDATE public.venues
        SET slug = m.new_slug
        WHERE id = m.venue_id;

    ELSE
      -- Unexpected state: neither the expected old slug nor the approved
      -- new slug. Abort rather than guess.
      RAISE EXCEPTION 'venue_slug_normalization: venue % has slug % but expected % (old) or % (new)',
        m.venue_id, v_current_slug, m.old_slug, m.new_slug;
    END IF;
  END LOOP;
END $$;
