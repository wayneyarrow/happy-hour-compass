-- Greater San Diego rollout — ROLLBACK (only if needed, only with approval).
-- Reverses apply.sql exactly. REFUSES if Encore Sushi has been published (unpublish it
-- first through Operator Admin) or if any other venue/guide/collection/homepage now
-- references the market — at that point roll back the code instead.
BEGIN;
DO $$
DECLARE mid uuid; n integer;
BEGIN
  SELECT id INTO mid FROM public.markets WHERE slug = 'greater-san-diego';
  IF mid IS NULL THEN RAISE EXCEPTION 'greater-san-diego not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.venues WHERE market_id = mid AND id <> '4ecc0d2c-3ef0-4f85-8f34-5b4e079e1840') THEN
    RAISE EXCEPTION 'other venues are assigned to greater-san-diego — not rolling back';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venues WHERE id = '4ecc0d2c-3ef0-4f85-8f34-5b4e079e1840' AND is_published) THEN
    RAISE EXCEPTION 'Encore Sushi is published — unpublish it first';
  END IF;
  UPDATE public.venues SET market_id = NULL, city_id = NULL
   WHERE id = '4ecc0d2c-3ef0-4f85-8f34-5b4e079e1840' AND market_id = mid;
  UPDATE public.markets SET default_city_id = NULL WHERE id = mid;
  DELETE FROM public.cities WHERE market_id = mid;   -- FK: other rows referencing these cities abort the transaction
  DELETE FROM public.markets WHERE id = mid;          -- FK: guides/collections/homepages referencing it abort the transaction
END $$;
COMMIT;
