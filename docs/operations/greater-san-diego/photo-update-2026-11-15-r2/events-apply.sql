-- event photo update APPLY: 4 rows, one transaction; each row must match exactly or nothing is applied.
BEGIN;
DO $do$
DECLARE c int;
BEGIN
  UPDATE public.events SET image_url = 'https://juphyhxdmcvseeufbiay.supabase.co/storage/v1/object/public/venue-images/events/05b66e23-2369-494b-ad78-7e5e68868252/a455b5c6-e248-46b5-a5f0-325c87efa4e6.jpg' WHERE id = '05b66e23-2369-494b-ad78-7e5e68868252' AND image_url = 'https://juphyhxdmcvseeufbiay.supabase.co/storage/v1/object/public/venue-images/events/05b66e23-2369-494b-ad78-7e5e68868252/c7d9f699-7164-468c-bea4-5faa1a46c769.jpg' AND updated_at = '2026-11-15T16:07:37.385098+00:00'::timestamptz AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 1 THEN RAISE EXCEPTION 'guard failed for % (chula-vista-savoie-italian-eatery-dj-night-fridays DJ-7)', '05b66e23-2369-494b-ad78-7e5e68868252'; END IF;
  UPDATE public.events SET image_url = 'https://juphyhxdmcvseeufbiay.supabase.co/storage/v1/object/public/venue-images/events/95e2e784-03dc-4afd-a161-3e5dcaae0563/7b5117a4-8681-4520-a81e-8879940dd10d.jpg' WHERE id = '95e2e784-03dc-4afd-a161-3e5dcaae0563' AND image_url = 'https://juphyhxdmcvseeufbiay.supabase.co/storage/v1/object/public/venue-images/events/95e2e784-03dc-4afd-a161-3e5dcaae0563/eb4d8788-ea87-4bb2-92db-9da49b067154.jpg' AND updated_at = '2026-11-15T16:07:37.385098+00:00'::timestamptz AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 1 THEN RAISE EXCEPTION 'guard failed for % (chula-vista-savoie-italian-eatery-dj-night-saturdays DJ-7)', '95e2e784-03dc-4afd-a161-3e5dcaae0563'; END IF;
  UPDATE public.events SET image_url = 'https://juphyhxdmcvseeufbiay.supabase.co/storage/v1/object/public/venue-images/events/04c3693a-a642-40c1-90b9-39dd5720bf78/591bc94a-34b7-438c-9b5b-45254e046a74.jpg' WHERE id = '04c3693a-a642-40c1-90b9-39dd5720bf78' AND image_url = 'https://juphyhxdmcvseeufbiay.supabase.co/storage/v1/object/public/venue-images/events/04c3693a-a642-40c1-90b9-39dd5720bf78/1ab53297-871e-4de9-b56c-f0812c7c4916.jpg' AND updated_at = '2026-11-15T16:07:37.385098+00:00'::timestamptz AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 1 THEN RAISE EXCEPTION 'guard failed for % (san-diego-urban-mos-sassy-sunday-funday DRAG-4)', '04c3693a-a642-40c1-90b9-39dd5720bf78'; END IF;
  UPDATE public.events SET image_url = 'https://juphyhxdmcvseeufbiay.supabase.co/storage/v1/object/public/venue-images/events/804d7bf0-3189-4a0e-8953-c4a74be184ba/11d611ca-a838-4344-8873-1975e48ae8d0.jpg' WHERE id = '804d7bf0-3189-4a0e-8953-c4a74be184ba' AND image_url = 'https://juphyhxdmcvseeufbiay.supabase.co/storage/v1/object/public/venue-images/events/804d7bf0-3189-4a0e-8953-c4a74be184ba/dc82b530-4dcc-44ea-83f1-2fd06cbb2abc.jpg' AND updated_at = '2026-11-15T16:07:37.385098+00:00'::timestamptz AND created_by_operator_id IS NULL AND updated_by_operator_id IS NULL;
  GET DIAGNOSTICS c = ROW_COUNT; IF c <> 1 THEN RAISE EXCEPTION 'guard failed for % (san-diego-urban-mos-dreamgirls-revue DRAG-3)', '804d7bf0-3189-4a0e-8953-c4a74be184ba'; END IF;
  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, entity_name, details_json)
  VALUES ('wayne.yarrow@gmail.com', 'seed_event_image_updated', 'event_batch', NULL, 'greater-san-diego',
          jsonb_build_object('count', 4, 'ids', jsonb_build_array('05b66e23-2369-494b-ad78-7e5e68868252', '95e2e784-03dc-4afd-a161-3e5dcaae0563', '04c3693a-a642-40c1-90b9-39dd5720bf78', '804d7bf0-3189-4a0e-8953-c4a74be184ba'), 'via', 'GSD photo QA 2026-11-15, approved by Wayne'));
END
$do$;
COMMIT;
