-- venue photo update ROLLBACK (restores the previous assignment; old files were never deleted): 1 rows, one transaction; each row must match exactly or nothing is applied.
BEGIN;
DO $do$
DECLARE c int;
BEGIN
  UPDATE public.venues SET placeholder_image_path = 'images/venues/casual-dining/venue-pic-casual-dining-10.jpg' WHERE id = 'd199414b-7f71-4b09-8fd0-9d45147f6949' AND placeholder_image_path = 'images/venues/taproom/venue-pic-taproom-13.jpg' AND source = 'seed' AND is_published AND claimed_at IS NULL AND claimed_by IS NULL AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL AND cancelled_at IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 1 THEN RAISE EXCEPTION 'guard failed for % (san-diego-working-class)', 'd199414b-7f71-4b09-8fd0-9d45147f6949'; END IF;
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, entity_name, details_json)
  VALUES ('wayne.yarrow@gmail.com', 'seed_venue_cover_rolled_back', 'venue_batch', NULL, 'greater-san-diego',
          jsonb_build_object('count', 1, 'ids', jsonb_build_array('d199414b-7f71-4b09-8fd0-9d45147f6949'), 'via', 'rollback of GSD photo QA 2026-11-15'));
END
$do$;
COMMIT;
