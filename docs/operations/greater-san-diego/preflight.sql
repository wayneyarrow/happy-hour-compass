-- Greater San Diego rollout — PREFLIGHT (read-only). Safe to run any time.
-- Run:  supabase db query --linked -f docs/operations/greater-san-diego/preflight.sql
-- Every statement runs inside a READ ONLY transaction: the database refuses any write.
-- The CLI prints only the LAST statement's rows, so everything is one SELECT.
BEGIN TRANSACTION READ ONLY;
SELECT
  -- 1. The market and city must not exist yet (expected: 0 / 0).
  (SELECT count(*) FROM public.markets WHERE slug = 'greater-san-diego')            AS existing_market_rows,
  (SELECT count(*) FROM public.cities  WHERE slug = 'solana-beach')                  AS existing_city_rows,
  -- 2. Encore Sushi's draft, exactly as the apply step requires it
  --    (expected: market_id/city_id null, unpublished, owned by Chris).
  (SELECT json_build_object(
     'name', name, 'city', city, 'region', region, 'country', country,
     'market_id', market_id, 'city_id', city_id, 'is_published', is_published,
     'created_by_operator_id', created_by_operator_id, 'claimed_by', claimed_by,
     'source', source, 'lat', lat, 'lng', lng, 'updated_at', updated_at)
   FROM public.venues WHERE id = '4ecc0d2c-3ef0-4f85-8f34-5b4e079e1840')            AS encore_before,
  -- 3. Venues the apply step will change (expected: exactly Encore Sushi).
  (SELECT json_agg(id) FROM public.venues
    WHERE id = '4ecc0d2c-3ef0-4f85-8f34-5b4e079e1840'
      AND market_id IS NULL AND city_id IS NULL AND is_published = false
      AND created_by_operator_id = '29ba66da-96b5-47ec-831d-b2a22b8903c9')           AS venues_to_assign,
  -- 4. Context: other unassigned venues stay untouched by this rollout.
  (SELECT json_agg(json_build_object('city', city, 'region', region, 'n', n, 'published', published))
     FROM (SELECT city, region, count(*) n, count(*) FILTER (WHERE is_published) published
             FROM public.venues WHERE market_id IS NULL AND city_id IS NULL
            GROUP BY city, region ORDER BY count(*) DESC) t)                         AS unassigned_venues_by_city,
  -- 5. Existing markets (unchanged by this rollout).
  (SELECT json_agg(json_build_object('slug', slug, 'status', status, 'display_order', display_order) ORDER BY display_order)
     FROM public.markets)                                                            AS markets_before;
COMMIT;
