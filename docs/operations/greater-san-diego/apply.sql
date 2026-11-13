-- Greater San Diego rollout — APPLY. Writes to the SHARED database (staging AND Production).
-- Run ONLY after Wayne's explicit approval, after preflight.sql shows the expected state:
--   supabase db query --linked -f docs/operations/greater-san-diego/apply.sql
-- One transaction. Every guard RAISEs (rolling back everything) unless exactly one market,
-- one city and one venue (Encore Sushi, still unassigned, unpublished and owned by Chris) change.
-- Touches no other market, city or venue; never sets is_published; preserves ownership/content.
BEGIN;

DO $$
DECLARE n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.markets WHERE slug = 'greater-san-diego') THEN
    RAISE EXCEPTION 'greater-san-diego already exists — nothing applied';
  END IF;

  -- Market — center/radius must match MARKETS in operator-admin/src/lib/markets.ts.
  INSERT INTO public.markets (slug, name, province, country, status, center_lat, center_lng, radius_km, display_order)
  VALUES ('greater-san-diego', 'Greater San Diego', 'CA', 'US', 'active', 32.85, -117.15, 60, 5);

  -- Initial city.
  INSERT INTO public.cities (market_id, slug, name, status, supports_neighbourhoods, display_order, center_lat, center_lng)
  SELECT id, 'solana-beach', 'Solana Beach', 'active', false, 1, 32.9912, -117.2711
    FROM public.markets WHERE slug = 'greater-san-diego';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 city inserted, got %', n; END IF;

  -- Header label city.
  UPDATE public.markets m SET default_city_id = c.id
    FROM public.cities c
   WHERE m.slug = 'greater-san-diego' AND c.market_id = m.id AND c.slug = 'solana-beach';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 default city set, got %', n; END IF;

  -- Encore Sushi — geography only. Ownership, content, photos, hours and
  -- is_published are not touched (updated_at is bumped by its trigger).
  UPDATE public.venues v
     SET market_id = m.id, city_id = c.id
    FROM public.markets m
    JOIN public.cities c ON c.market_id = m.id AND c.slug = 'solana-beach'
   WHERE m.slug = 'greater-san-diego'
     AND v.id = '4ecc0d2c-3ef0-4f85-8f34-5b4e079e1840'
     AND v.market_id IS NULL AND v.city_id IS NULL
     AND v.is_published = false
     AND v.created_by_operator_id = '29ba66da-96b5-47ec-831d-b2a22b8903c9';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected Encore Sushi (1 venue) assigned, got % — nothing applied', n; END IF;
END $$;

-- Verification (printed by the CLI): expected market active/US with default city
-- solana-beach, and Encore assigned, still unpublished, still owned by Chris.
SELECT m.slug AS market, m.status, m.country, dc.slug AS default_city,
       v.name, v.is_published, v.created_by_operator_id, vc.slug AS venue_city,
       v.market_id = m.id AS venue_in_market
  FROM public.markets m
  LEFT JOIN public.cities dc ON dc.id = m.default_city_id
  LEFT JOIN public.venues v ON v.id = '4ecc0d2c-3ef0-4f85-8f34-5b4e079e1840'
  LEFT JOIN public.cities vc ON vc.id = v.city_id
 WHERE m.slug = 'greater-san-diego';

COMMIT;
