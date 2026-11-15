-- venue photo update APPLY: 5 rows, one transaction; each row must match exactly or nothing is applied.
BEGIN;
DO $do$
DECLARE c int;
BEGIN
  UPDATE public.venues SET placeholder_image_path = 'images/venues/fine-dining/venue-pic-fine-dining-10.jpg' WHERE id = 'b2023e0a-8609-4225-9ae4-9c6bfb0694fd' AND placeholder_image_path = 'images/venues/fine-dining/venue-pic-fine-dining-1.jpg' AND updated_at = '2026-11-14T21:18:47.419974+00:00'::timestamptz AND source = 'seed' AND is_published AND claimed_at IS NULL AND claimed_by IS NULL AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL AND cancelled_at IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 1 THEN RAISE EXCEPTION 'guard failed for % (carlsbad-vigiluccis-seafood-steakhouse)', 'b2023e0a-8609-4225-9ae4-9c6bfb0694fd'; END IF;
  UPDATE public.venues SET placeholder_image_path = 'images/venues/casual-dining/venue-pic-casual-dining-39.jpg' WHERE id = '390bd35d-d528-4b20-ba5d-914a33cc2b1c' AND placeholder_image_path = 'images/venues/casual-dining/venue-pic-casual-dining-28.jpg' AND updated_at = '2026-11-15T03:54:45.136347+00:00'::timestamptz AND source = 'seed' AND is_published AND claimed_at IS NULL AND claimed_by IS NULL AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL AND cancelled_at IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 1 THEN RAISE EXCEPTION 'guard failed for % (chula-vista-p-f-changs-otay-ranch)', '390bd35d-d528-4b20-ba5d-914a33cc2b1c'; END IF;
  UPDATE public.venues SET placeholder_image_path = 'images/venues/casual-dining/venue-pic-casual-dining-40.jpg' WHERE id = '6e2a112d-b0b2-4990-a66c-53fe5935cec8' AND placeholder_image_path = 'images/venues/casual-dining/venue-pic-casual-dining-25.jpg' AND updated_at = '2026-11-15T03:54:45.136347+00:00'::timestamptz AND source = 'seed' AND is_published AND claimed_at IS NULL AND claimed_by IS NULL AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL AND cancelled_at IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 1 THEN RAISE EXCEPTION 'guard failed for % (chula-vista-the-cheesecake-factory-otay-ranch)', '6e2a112d-b0b2-4990-a66c-53fe5935cec8'; END IF;
  UPDATE public.venues SET placeholder_image_path = 'images/venues/fine-dining/venue-pic-fine-dining-7.jpg' WHERE id = 'e11e4062-5915-4592-b4ff-f039d952cf9b' AND placeholder_image_path = 'images/venues/casual-dining/venue-pic-casual-dining-2.jpg' AND updated_at = '2026-11-14T21:18:47.419974+00:00'::timestamptz AND source = 'seed' AND is_published AND claimed_at IS NULL AND claimed_by IS NULL AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL AND cancelled_at IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 1 THEN RAISE EXCEPTION 'guard failed for % (chula-vista-casa-nori-sushi-bar-grill)', 'e11e4062-5915-4592-b4ff-f039d952cf9b'; END IF;
  UPDATE public.venues SET placeholder_image_path = 'images/venues/fine-dining/venue-pic-fine-dining-5.jpg' WHERE id = 'd98407e4-f237-471c-b491-9a1a025b3d13' AND placeholder_image_path = 'images/venues/fine-dining/venue-pic-fine-dining-7.jpg' AND updated_at = '2026-11-15T01:23:56.998011+00:00'::timestamptz AND source = 'seed' AND is_published AND claimed_at IS NULL AND claimed_by IS NULL AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL AND cancelled_at IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 1 THEN RAISE EXCEPTION 'guard failed for % (coronado-peohes)', 'd98407e4-f237-471c-b491-9a1a025b3d13'; END IF;
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, entity_name, details_json)
  VALUES ('wayne.yarrow@gmail.com', 'seed_venue_cover_updated', 'venue_batch', NULL, 'greater-san-diego',
          jsonb_build_object('count', 5, 'ids', jsonb_build_array('b2023e0a-8609-4225-9ae4-9c6bfb0694fd', '390bd35d-d528-4b20-ba5d-914a33cc2b1c', '6e2a112d-b0b2-4990-a66c-53fe5935cec8', 'e11e4062-5915-4592-b4ff-f039d952cf9b', 'd98407e4-f237-471c-b491-9a1a025b3d13'), 'via', 'GSD photo QA 2026-11-15, approved by Wayne'));
END
$do$;
COMMIT;
