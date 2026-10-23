# "Explore These Local Favourites" rail — configuration rollout

**Status: APPLIED 2026-10-23 ~22:50Z** via the SQL below, after Production was promoted to `1380628` (`630a6ce` + the ordering-reset fix). The new Collection's id is `b52710a1-e423-4539-b48b-17d56513e63b`; its homepage section id is `e13a93cc-2d82-4d27-9c06-7de54dfa7a04`. The SQL path wrote no Control Panel audit-log rows.

**Pre-apply snapshot** (all homepage and Collection tables, taken 2026-10-23T22:45Z): `operator-admin/scripts/output/local-favourites-rollback-2026-10-23/`. It's gitignored and exists only on the machine that ran the rollout.

## Order of operations

1. **Promote the code to Production first.** Production code that predates the `local-favourites` algorithm resolves the new Collection to nothing and hides the section. If the data went in first, the reorder and the Highly Rated change would go live without the new rail.
2. Apply steps A–D below, using the Control Panel (preferred: validation and audit log) or the SQL.
3. Run the post-apply checks.

## A. Create the Collection

Control Panel → Collections → New:

| Field | Value |
|---|---|
| Name | Explore These Local Favourites |
| Slug | `explore-these-local-favourites` (not in use; checked 2026-10-23) |
| Type | Venue |
| Market / City | Central Okanagan / *(none)* |
| Curation | Algorithmic → **Local Favourites (verified venues only)** |
| Item Limit | 10 |

Then Edit → Status **Published** → Save. Publishing requires at least one resolved venue (30 qualify today).

## B. Move Highly Rated to market geography

Collections → Highly Rated (`c67e9616-7826-4004-a35e-9def4728656d`) → City: *(none)* → Save. It has no overrides, so the geography-change guard allows this. The landing page URL stays `/central-okanagan/collections/highly-rated`.

## C. Add the section and D. reorder the Kelowna Homepage

Homepages → Kelowna Homepage (`fd565840-698d-47b7-84dc-fcd4252a6ebc`) → add a Venue Collection Section titled **Explore These Local Favourites** using the new Collection, then order the sections:

1. Explore These Local Favourites
2. Today's Specials
3. Featured Kelowna Events
4. Patio Picks
5. Guide Feature
6. Highly Rated
7. Venue Feature
8. Kelowna Guides

Do **not** publish or change the Central Okanagan Homepage.

## Equivalent SQL (one transaction)

```sql
BEGIN;

INSERT INTO public.collections
  (name, slug, collection_type, market_id, city_id, status, algorithm_key, item_limit, created_by, updated_by)
VALUES
  ('Explore These Local Favourites', 'explore-these-local-favourites', 'venue',
   '39083a78-532d-4628-b2cb-d8e6618a15c2', NULL, 'published', 'local-favourites', 10,
   'wayne.yarrow@gmail.com', 'wayne.yarrow@gmail.com');

UPDATE public.collections SET city_id = NULL, updated_at = now(), updated_by = 'wayne.yarrow@gmail.com'
WHERE id = 'c67e9616-7826-4004-a35e-9def4728656d';                       -- Highly Rated

INSERT INTO public.homepage_sections
  (homepage_id, section_type, content_mode, title, collection_id, display_order, created_by, updated_by)
SELECT 'fd565840-698d-47b7-84dc-fcd4252a6ebc', 'venue', 'collection', 'Explore These Local Favourites',
       id, 0, 'wayne.yarrow@gmail.com', 'wayne.yarrow@gmail.com'
FROM public.collections WHERE slug = 'explore-these-local-favourites'
  AND market_id = '39083a78-532d-4628-b2cb-d8e6618a15c2';

UPDATE public.homepage_sections s SET display_order = o.pos, updated_at = now()
FROM (VALUES
  ('caf83444-daea-4371-ac1e-f6c093201114'::uuid, 1),  -- Today's Specials
  ('950b3e62-3c15-4279-8cb2-b1170ec68b5a'::uuid, 2),  -- Featured Kelowna Events
  ('95563d8c-6e5f-4e27-afc9-08a1f500d2fa'::uuid, 3),  -- Patio Picks
  ('f456e783-766a-4158-9320-9d615f07fce9'::uuid, 4),  -- Guide Feature
  ('e49bf4ea-045b-4e8e-af8e-c4c2dd0ece1e'::uuid, 5),  -- Highly Rated
  ('c8a810db-eb2e-44e8-af89-b22105eb5edf'::uuid, 6),  -- Venue Feature
  ('fbece669-4662-4573-9cb2-3d96227a0992'::uuid, 7)   -- Kelowna Guides
) AS o(id, pos)
WHERE s.id = o.id AND s.homepage_id = 'fd565840-698d-47b7-84dc-fcd4252a6ebc';

COMMIT;
```

The SQL path writes no Control Panel audit-log rows.

**Rollback:** delete the new section, then archive or delete the new Collection. Set Highly Rated's `city_id` back to Kelowna (`13fe3ede-55db-41a7-a8f6-20d94e62445a`). Restore the original `display_order` values: Highly Rated 0, Patio Picks 1, Today's Specials 2, Guide Feature 3, Featured Kelowna Events 4, Venue Feature 5, Kelowna Guides 6.

## Post-apply checks

- The Kelowna Homepage shows the new rail first, at desktop and phone widths. Erica Jane and Kelly & Carlos O'Bryan's – Kelowna are #1 and #2 while their Premium Comps are active.
- "View all" opens `/central-okanagan/collections/explore-these-local-favourites` and lists the same venues.
- Card impressions, card clicks and the "View all" click record in `website_discovery_events` with the new section's id and `section_kind = venue_collection`.
- Highly Rated now includes eligible West Kelowna and Lake Country venues.

## Follow-up (separate, not started): Today's Specials inconsistencies

Today's Specials was deliberately left unchanged by this rollout:
- **Ordering:** `selectTodaysSpecials` ranks by Boost and merit only, so stored positions are ignored. Move Up/Down in its editor has no effect, and "Reset ordering overrides" isn't offered there.
- **Discover exclusions:** the Daily Specials pool never checks `venues.exclude_from_discover`, for algorithm picks or forced includes, unlike every other algorithmic Collection.
