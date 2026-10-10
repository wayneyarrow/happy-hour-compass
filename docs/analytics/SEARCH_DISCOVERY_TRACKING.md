# Search & Discovery Tracking — Definitions (migration 110)

The reference for anyone building reports on website search and homepage/guide discovery. Use these definitions and denominators. Don't re-derive them from row counts.

## Environment (all website tracking tables)

`environment` is set server-side by every `/api/track/*` route (`src/lib/analyticsEnvironment.ts`):

| Value | Meaning |
|---|---|
| `production` | Vercel Production (`main` → happyhourcompass.com, kelownahappyhours.com, happy-hour-compass.vercel.app) |
| `staging` | Vercel Preview built from the `website` branch (staging.happyhourcompass.com) |
| `preview` | Any other Vercel Preview |
| `development` | Not on Vercel (local dev, scripts) — local dev writes to the shared DB too |
| `NULL` | Legacy/unknown: written before the migration-110 code deployed. Never backfilled. |

**Reports should default to `environment = 'production'`** and show legacy (`NULL`) history only with a caveat.

## Search — `website_search_events`

One row per *meaningful* search (not per keystroke):

- **Pause:** the query stayed unchanged for 1s once its results were known.
- **Enter:** captured immediately when Enter is pressed.
- **Selection:** a hero suggestion was chosen (captured immediately).
- **See all:** the hero's "See all … matching" option (captured immediately).

The same mode + case-insensitive term is captured once until the field is cleared or the term changes.

| Column | Meaning |
|---|---|
| `surface` | `homepage_hero` or `listing_page` |
| `mode` | `happy_hours` / `daily_specials` / `events` (which entity was searched; on listing pages, which page) |
| `origin` | `typed`; `url` (page opened with `?q=` — external/pasted link); `history` (Back/Forward restored it); `hero_see_all` (handed over by the hero, which already logged its own row) |
| `capture_trigger` | `pause` / `enter` / `selection` / `see_all` |
| `result_count` | Full number of matches. Hero: total before the 8-suggestion display cap. Listing pages: after all active filters. |
| `result_count_capped` | `false` = full total. `NULL` = legacy (legacy hero rows were capped at 8) |
| `other_filters_active` | Listing pages: non-text filters also narrowed `result_count` |
| `search_id` | Links a hero search to its `suggestion_select` discovery event |

Reporting guidance:

- **Count demand** as `origin IN ('typed','url')` rows.
  - Exclude `hero_see_all`: it duplicates the hero row.
  - Exclude `history`: it's a re-display of an earlier search.
- **Zero-result searches:** `result_count = 0` with `other_filters_active IS NOT TRUE`.
- **What counts as one search:** a search is mode + case-insensitive term.
  - Consecutive repeats are collapsed, so Enter + pause + selection is one row. A → B → A is three rows.
  - Filter changes after a term is captured add no row. The row keeps the count and `other_filters_active` from capture time; filters already set before typing are reflected in that count.
  - A new page instance starts fresh, so Back to a listing page records an `origin = 'history'` row.
- **Hero Enter while results are loading:** the hero needs its result count before it can record a row, so an Enter pressed while "Searching…" is shown is held until results arrive. If the visitor changes the text or the mode first, the held Enter is dropped: those results are discarded and never arrive. The new text or mode is then captured on its own pause or Enter. Hero results usually take about 1.3s; a cold start took about 2.6s in staging QA.
- **`session_id`** is one browser tab (sessionStorage), not a person.
- **Legacy rows** (`mode IS NULL`) include partial words from the old 200ms capture. Treat them separately.

## Discovery — `website_discovery_events`

| `event_type` | Definition |
|---|---|
| `item_impression` | A card was **≥50% visible for ≥1 continuous second while the tab was visible** (clipped by horizontal rails). Once per page view per placement + item. |
| `section_exposure` | The section's heading marker met the same rule. Once per page view per section / guide block. |
| `item_click` | A link inside the card was activated. Double-clicks within 1s count once. |
| `view_all_click` | A section's "View all" (`surface = homepage_section`), or the hero's "See all … matching" (`surface = homepage_hero`, with `mode`, `search_id`). |
| `browse_click` | The hero's Browse button (`mode`, `target_path`). |
| `suggestion_select` | A hero suggestion was chosen (`item_*`, `position`, `mode`, `search_id`). |

- **Placement:**
  - `surface = homepage_section` + `section_id` (`homepage_sections.id`) + `section_kind`.
  - `surface = guide` + `guide_id` (`content_guides.id`, stable across slug changes) + `guide_block` (`venues` / `events` / `related_guides`).
  - `surface = homepage_hero`.
- **Items:** `item_type` ∈ `venue`, `event`, `guide`, `daily_special`, and `item_id` is that record's UUID. Venues use the venue UUID, never the slug.
- **`position`:** the 0-based index in the placement as rendered when the event fired.
- **`page_view_id`:** one mounted homepage or guide page. A client navigation away and back is a new page view.

### Metrics and denominators

Join key for one placement in one page view: `page_view_id` + placement (`section_id`, or `guide_id` + `guide_block`, or hero) + `item_type` + `item_id`. Every impression, exposure and click carries all of them.

| Metric | Definition | Range |
|---|---|---|
| **Section reach** | `COUNT(DISTINCT page_view_id)` with a `section_exposure` for the section | count |
| **Section engagement rate** | Exposed page views with ≥1 *section click* in that section ÷ section reach. A section click is an `item_click` or `view_all_click` in the section. Count page views, not clicks, so several clicks in one visit count once. | 0–100% |
| **Item CTR** | Distinct impressed combinations (`page_view_id` + placement + item) with **at least one** matched `item_click` ÷ distinct impressed combinations. Both sides count combinations, never rows: a combination clicked three times counts once, so CTR is always 0–100%. | 0–100% |
| Position CTR | Item CTR grouped by `position` within a placement | 0–100% |
| **Raw clicks** | Every `item_click` row (matched or not), for totals such as venue click counts and the Operator Admin Discover Clicks figure. **Never a CTR numerator.** | count |
| Unmatched clicks | `item_click` with no `item_impression` for the same combination. A subset of raw clicks, reported separately. | count |
| Clicks outside exposure | Section clicks in page views with no `section_exposure` for that section. Excluded from engagement rate, reported separately. | count |
| Venue discovery | Impressions/clicks where `item_type = 'venue'`, plus Daily Special items joined to `daily_specials.venue_id` (and events to `events.venue_id` if wanted) | count |

**Never divide total clicks by exposures.** Several clicks in one page view would push that above 100%.

#### Clicks made before the one-second threshold

An impression needs the card ≥50% on screen for 1 continuous second. **A click does not stop that clock.** The impression is only abandoned if the page actually changes, which unmounts the card, before the second is up. So:

- **Unmatched click:** the visitor clicked and the next page replaced the homepage within 1 second. That click has no impression.
  - It still counts as a click: for venue click totals, and in the Operator Admin Discover Clicks figure.
  - It is excluded from Item CTR, which only counts combinations that have an impression. Its card was never counted as "seen", so CTR stays ≤100% and keeps the strict "seen" definition. It still appears in raw clicks.
- **Matched click with a late impression:** the visitor clicked early, but the card stayed on screen for a full second before the page changed. Next.js keeps the current page mounted while it loads the next one, which took over 1s on staging during QA (an impression landed 2.4s after its click). The card genuinely was on screen ≥1s, so the impression is truthful and the click is matched.

Expect the unmatched share to depend on how fast the next page loads, not only on how fast the visitor clicks.

The opposite order is also fine. If a click opens a new tab while the card stays on screen, the impression is recorded afterwards in the same page view and the click *is* matched. Matching uses the join key, not timestamps.

A high unmatched-click share for a placement means visitors act on it quickly. Show the share next to CTR rather than hiding it.

Reference SQL for Item CTR (production, one homepage section; for a guide block filter on `guide_id` + `guide_block` instead):

```sql
with imp as (
  select distinct page_view_id, item_type, item_id
  from website_discovery_events
  where environment = 'production' and event_type = 'item_impression' and section_id = :section
),
clk as (
  select distinct page_view_id, item_type, item_id
  from website_discovery_events
  where environment = 'production' and event_type = 'item_click' and section_id = :section
)
select
  count(*) filter (where c.page_view_id is not null) as impressed_with_click,
  count(*) as impressed,
  round(count(*) filter (where c.page_view_id is not null)::numeric / nullif(count(*), 0), 4) as item_ctr
from imp i
left join clk c using (page_view_id, item_type, item_id);
```

#### Not measured

There is no page-view event for the homepage or guides. Reach is an absolute count of exposed page views, not a share of all page views.

**Never mix these with `venue_discover_events`.** Its impressions are **load-based** (written when a rail rendered, not when it was seen):

- The website wrote it until migration 110.
- The consumer app still writes it.

Historical website rows there (`rail_name` `homepage_rail:` / `homepage_feature:` / `guide:`) can be reported as "legacy clicks" and "legacy loads", never as impressions or as a CTR denominator.

## Relationship to other tables

| Table | What it records | Relationship |
|---|---|---|
| `venue_discover_events` | Consumer app, plus pre-110 website (load-based) | Superseded for the website; no overlap after deploy |
| `daily_special_click_events` | Clicks on Daily Special cards in the **Daily Specials search results** page (`source = search_results`) | Separate surface. Homepage Today's Specials clicks are `website_discovery_events` `daily_special` items |
| `venue_view_events` / `event_view_events` | Detail-page views (any source) | Same `session_id`, so a click → view chain can be joined |

## Operator Admin (Premium) "Discover Impressions / Clicks"

See `src/lib/discoveryTracking/venueDiscoveryMetrics.ts`. Both cover the venue's cards and its Daily Special cards, last 30 days, production only.

- **Impressions:** on-screen `item_impression` rows only. They build up from the deploy date.
- **Clicks:** new `item_click` rows plus legacy/production `venue_discover_events` clicks.
