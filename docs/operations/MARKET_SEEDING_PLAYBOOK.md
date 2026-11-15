# Market Seeding Playbook

How to seed a new Happy Hour Compass market with verified, publish-ready venue listings — from coverage plan to live pages.
Written from the Greater San Diego (GSD) rollout, November 2026: 81 public venues across 4 seed batches. Each step gives the
**reusable process** first, then the **San Diego example**.

> **This playbook is the current seeding workflow.** The Greater San Diego coverage plan and rollout runbooks listed below
> are **historical references**: they record how the market was opened and the original pilot, and parts of them are now
> out of date (for example, the coverage plan predates storing Google ratings for seeds, and the Step 2 runbook predates
> Batches 2–4 and the reviewed shared-address exception). Where they differ from this playbook, follow this playbook.

**Ground rules (apply to every step)**

- **One shared database.** Staging and Production use the same Supabase project, so every data write is live in both the
  moment it runs. Reads are fine at any time; **every write needs Wayne's explicit approval** for that specific action.
- **Claude owns source QA.** Claude finds, verifies, rechecks and fixes listing data, and brings Wayne only decisions that
  need his judgment (policy, conflicting rules, anything the sources genuinely can't settle).
- **Venue-owned evidence only.** Guides find leads; only the venue's own website, menus and social profiles verify facts.
- **Never work around a block.** A 403, 429, captcha or "verify you are human" page means the venue is held as `blocked`.
  Don't retry with other user agents, tools, mirrors or caches.
- **Two approval gates per batch:** Wayne approves the **draft import** (after the read-only dry run), then separately
  approves **publication** (after the drafts are verified). See [Step 5](#5-import-and-publish).

**Evidence used for this playbook**

| What | Where |
|---|---|
| Step 1 runbook (market + first city) — *historical reference* | [`GREATER_SAN_DIEGO_ROLLOUT.md`](GREATER_SAN_DIEGO_ROLLOUT.md) |
| Step 2 runbook (city roster, importer, pilot) — *historical reference* | [`GREATER_SAN_DIEGO_STEP2_ROLLOUT.md`](GREATER_SAN_DIEGO_STEP2_ROLLOUT.md) |
| Coverage plan (90-venue target, roster, pilot) — *historical reference* | [`greater-san-diego/GSD_SEED_COVERAGE_PLAN.md`](greater-san-diego/GSD_SEED_COVERAGE_PLAN.md) |
| Committed batch CSVs (import + review) | [`greater-san-diego/pilot/`](greater-san-diego/pilot/), [`batch2/`](greater-san-diego/batch2/), [`batch3/`](greater-san-diego/batch3/), [`batch4/`](greater-san-diego/batch4/) |
| Research leads | [`greater-san-diego/research/gsd-research-candidates.csv`](greater-san-diego/research/gsd-research-candidates.csv) |
| City roster + aliases | [`operator-admin/src/lib/geo/rosters/greaterSanDiego.ts`](../../operator-admin/src/lib/geo/rosters/greaterSanDiego.ts) |
| Importer (planning/validation) and CLI | [`operator-admin/src/lib/seeding/marketVenueImport.ts`](../../operator-admin/src/lib/seeding/marketVenueImport.ts), [`operator-admin/scripts/importMarketVenuesFromCsv.ts`](../../operator-admin/scripts/importMarketVenuesFromCsv.ts) |
| Importer tests | [`operator-admin/tests/unit/seeding/marketVenueImport.test.ts`](../../operator-admin/tests/unit/seeding/marketVenueImport.test.ts) |
| Stock photo source records | [`stock-photos/unsplash-2026-11-14-sources.csv`](stock-photos/unsplash-2026-11-14-sources.csv), [`stock-photos/unsplash-2026-11-14-batch2-sources.csv`](stock-photos/unsplash-2026-11-14-batch2-sources.csv) |

---

## 1. Plan coverage

### Reusable steps

1. **Define the market.** One consumer-facing market (e.g. "Greater San Diego"); each listing keeps its **real city**
   (Google's `locality`). Neighbourhoods and subregions are internal tracking tags only.
2. **Build the city roster** as a code file under `operator-admin/src/lib/geo/rosters/`:
   - incorporated cities that get seeds, with a `launchTarget` each;
   - unincorporated communities as submission-only (target 0);
   - market-scoped **aliases** (neighbourhood/postal names → city, e.g. "La Jolla" → San Diego), checked against what
     Google actually returns as `locality` (read-only Places probes);
   - city centres from public-domain sources (US Census Gazetteer), never Google coordinates.
   Generate and apply the city SQL as in the [Step 2 runbook](GREATER_SAN_DIEGO_STEP2_ROLLOUT.md) (preflight → apply with approval → verify).
3. **Set a target as a planning weight, not a quota.** Weight cities by population and nightlife/visitor density.
4. **Before every batch, count what's live** (published venues per city and neighbourhood) against the targets.
5. **Rank gap areas by demand:** existing coverage (fewest listings first), local dining activity (restaurant/bar
   concentration, independent local guides) and visitor activity (tourism-board guides, hotel and convention areas,
   major attractions). Give most of a batch to busy areas with few listings; use the rest to widen thin outer areas.
   Record the evidence for the area choice in the batch report.
6. **Batch size:** 15–25 qualifying venues per batch; screen about 2–3× that many candidates (see pass rates below).

### San Diego example

- **Target: 90 venues** across 18 cities (roster `launchTarget` sum = 90): City of San Diego 48, North County Coastal 16,
  North County Inland 9, South Bay 9, East County 8 — weighted from population share toward nightlife and visitor density
  ([coverage plan §1](greater-san-diego/GSD_SEED_COVERAGE_PLAN.md)).
- **Batches:** pilot 2 (+ Encore Sushi, operator-owned) → Batch 2: 24 → Batch 3: 31 (downtown core, coastal visitor areas,
  uptown) → Batch 4: 20 + 3 shared-address venues (Ocean Beach, Point Loma, Embarcadero, Old Town, East County) = **81 live**.
- **Closeout: launch at 81.** Wayne decided that **81 live venues provide enough geographic coverage for launch**. The 90
  was a coverage plan, not a quota, so San Diego seeding closed at 81. The remaining gaps and holds below are kept as
  context for later rounds, not as launch blockers:
  - Coverage meets or beats the plan where demand is highest — City of San Diego 50/48, La Mesa 6/3, Coronado 3/2 —
    and every subregion has listings.
  - Remaining shortfalls against the plan: Oceanside 2/5, Encinitas 2/4, Escondido 2/4, El Cajon 1/3, Chula Vista 5/6,
    Santee 0/2, Vista 0/2, Poway 0/1, Del Mar 0/1. These are mostly where candidates kept failing the publish standard:
    no published closing times, no priced happy hour, access blocks, or closed/parked domains.
  - Hold mix for reference: Batch 2 held 32 of 56 (10 blocked, 6 no priced offers, 5 not found, 5 incomplete hours);
    Batch 3 held 27 of 58; Batch 4 held 31 of 54 after the three shared-address venues were released (11 not found,
    7 blocked, 6 no priced offers). Holds and their reasons are in each batch's review CSV; Finca and Herb & Sea
    (happy hour paused until about 2027-01-10) are the main recheck candidates.
  - A later round can deepen the thin cities (the coverage plan sketches ~150: more San Diego, Chula Vista, Oceanside,
    Escondido) using the same steps.

---

## 2. Research and verify

### Reusable steps

1. **Find leads** in directories and guides — existing research CSV, King of Happy Hour, local magazines, Infatuation,
   Eater, Atly, tourism and neighbourhood directories. These are **discovery only**.
2. **Exclude** everything already live or already screened (all earlier review CSVs' holds), and anything parked on purpose.
3. **Screen in this order, stopping at the first failure** (hold codes in brackets):
   1. Operating: no closure notice, current site [`closed`, `not_found`].
   2. **Full weekly opening hours, all 7 days:** each day has open + close or is explicitly closed. A stated day range
      ("Tuesday – Sunday") means the excluded days are closed unless another venue page gives hours for them. A list that
      skips days mid-sequence is not a range [`closure_not_explicit`]. "Late"/"until close" with no time anywhere
      [`hours_incomplete`]. Never substitute kitchen hours when part of the venue opens earlier than any published close.
   3. **Current happy hour schedule:** days and times. "Until close" = that day's close. Conflicting venue pages: a clearly
      newer **dated** source wins; otherwise keep only the windows both agree on and record what was dropped. Never pick a
      side of a business-hours conflict without a dated reason [`conflict`]. Seasonal/paused [`paused`]; nothing newer
      than 12 months [`stale`].
   4. **Priced offers:** at least **one clearly priced happy-hour item or one stated discount** qualifies
      ("$2 off beers"). Capture **up to 3 food and 3 drink** offers where available, in the venue's own wording
      ("$6 Select Apps" → name "Select Apps", price 6) [`no_priced_offers`].
   5. Every happy hour window inside that day's opening hours [`hh_outside_hours`].
4. **Open the full menu, not just the text.** Render pages and read screenshots; click every menu tab; open every PDF
   page, image menu and embedded widget (if a widget is blank in the page, open its own URL); read both food and drink;
   pair names and prices from the screenshot when text extraction separates them.
5. **Second look before any hold** for missing offers, prices, schedules, hours or closures — then an **independent
   recheck** of those holds by a fresh pass that treats the first screener's notes as leads only.
6. **Record evidence for every fact:** URL, page/section or PDF page, exact quote, date (menu date, PDF filename,
   sitemap `lastmod`, post date).
7. **Bring Wayne only real decisions** (e.g. a policy call); settle everything the sources can settle.

### Precedents set in San Diego (reuse them)

| Situation | Decision | Example |
|---|---|---|
| "Happy hour daily" + a stated closed day | HH on the open days only | The Riviera (Wayne confirmed), Mediterraneo |
| Conflicting undated schedules | Keep only the agreed window/days | Savoie (Tue–Sun 4–6:30 kept, Monday dropped), The Bowl |
| One window outside posted hours, rest fine | Drop that window/day, never cap it | La Doña (Monday), Tahona (weekend) |
| Newer dated source | It wins | The Nolen ("new expanded hours" + widget dated Nov 12), Peohe's (sitemap `lastmod`) |
| Brand-wide HH that never names the location | Hold | Phil's BBQ – Santee |
| Restaurant hours list HH as a service period | Venue open from HH start | Roppongi |

### San Diego example — pass rates

Batch 3 screened 58: 48% passed first look, 53% after rechecks. Batch 4 screened 54: 37% first look, 43% after rechecks.
Typical recoveries came from an image menu or tab the first pass missed, or from keeping only verified windows.

---

## 3. Build and review the batch

### CSV fields (importer columns)

All columns the importer accepts are listed in `SEED_CSV_COLUMNS` in the importer; anything else blocks the batch.

| Group | Columns | Notes |
|---|---|---|
| Identity | `slug`, `name`, `establishment_type` | Slug = `<city-slug>-<name>` without apostrophes or a repeated city. Type must be an Operator Admin option. |
| Address | `address_line1`, `city`, `region`, `postal_code`, `country` | Keep the suite/unit as published. `city` = Google locality's roster city. |
| Geography | `market_slug`, `city_slug` | Must resolve to an active market and one of its cities. |
| Map pin | `lat`, `lng`, `coordinates_source` | US Census Geocoder (`Public_AR_Current`) address match; never Google coordinates; never a city centre. |
| Contact | `phone`, `website_url`, `menu_url` | `(ddd) ddd-dddd`; venue-owned URLs. |
| Hours | `business_hours`, `business_hours_verified` (`true`), `business_hours_source` | JSON with all 7 lowercase days, `{open, close}` (HH:MM) or `null` = closed. |
| Happy hour | `hh_times`, `hh_tagline`, `hh_food_details`, `hh_drink_details`, `hh_times_needs_review` | `hh_times` lines like `Monday – Friday: 3 PM – 6 PM` (en dashes; `Daily:`). Specials = JSON `[{name, price, notes}]`, max 3 each. Tagline only for a verified, guest-relevant restriction (e.g. "Happy hour: dine-in only."); drop generic disclaimers. |
| Google | `place_id`, `google_rating`, `google_review_count`, `google_rating_retrieved_at` | Rating + count only together, with the Place ID and retrieval timestamp. |
| Image | `placeholder_image_path` | `images/venues/<category>/<file>`; must exist under `operator-admin/public/`. |
| Provenance | `source` (`seed`), `is_published` (`false`) | The importer only creates unpublished seed drafts. |
| Shared address (optional) | `shared_address_with`, `shared_address_evidence` | Review columns, never stored — see below. |

### Checks while building

- **Exact-location Place ID.** Match Google's listing to the venue on **street number + ZIP + name** (compare the numeric
  part, so "880 B" = "880"). It must be `OPERATIONAL`. If search returns an address-only result, retry with the venue's
  full name; if Google lists a different address for the same venue (e.g. Belmont Park's boardwalk address), attach the
  Place ID by a recorded override after confirming name, phone and website match.
- **City:** Google `locality` → roster city via the roster aliases; anything outside the roster is held.
- **Ratings and the open storage question.** Wayne approved storing `google_rating` and `google_review_count` for seeds
  (2026-11-14); every other Google-derived column is refused by the importer. The ratings are **snapshots** dated by
  `google_rating_retrieved_at`. The broader Places storage terms are **still unresolved** (no refresh cadence agreed), so
  don't run `npm run refresh:seeded-venues -- --apply` on a seeded US market until that's decided.
- **Map pins:** Census address match (retry without the suite). No match → hold `no_pin`, never an approximate pin.
- **Images:** assign by **fit** to the venue (cuisine, setting, bar vs dining room), never by file order. Prefer photos
  unused in the market; never repeat one within the market; weaker shots last; never a photo with brand signage.
- **Discovery tags** (`seeded_tags`) are generated by the importer from the verified offers — never put them in the CSV.
  **Operator Search Tags (`search_tags`) stay empty**; the importer never writes them.
- **Review CSV** alongside the import CSV: one row per screened venue with batch status, hold code/reason, sources,
  quotes, Google match, pin source, photo choice and QA notes.

### Duplicates, held rows and the reviewed shared-address exception

- The import CSV contains **only qualifying rows**; holds live in the review CSV and never enter the import file.
- The importer blocks before any write: same Place ID or slug as an existing venue → skipped untouched; same slug in
  history → blocked; same **address** or **name + city** as an existing venue or an earlier CSV row → blocked.
- Addresses are compared without suite numbers, so separate venues in one building or mall collide. **A shared address
  is allowed only when it was reviewed:** the row lists the other venue's slug in `shared_address_with`, records
  evidence in `shared_address_evidence`, both venues have distinct verified Place IDs, and — where both publish a suite —
  the suites differ. The dry run then shows a `shared_address_reviewed` warning (e.g. "unit 1401 vs 720").
- **Still blocked:** unreviewed collisions (even with different Place IDs), the same suite, and any matching Place ID.
  Each row is checked against **every** earlier venue at that address, in the database and in the CSV.

### San Diego example

[`batch4/gsd-batch4-shared-address.csv`](greater-san-diego/batch4/gsd-batch4-shared-address.csv): OB Surf Lodge
(Suite 1F, same building as Wonderland Ocean Pub at Ste 2B), The Cheesecake Factory and P.F. Chang's (Suite 1401) at Otay
Ranch Town Center with Savoie (Suite #720). Evidence: each venue's own address page plus distinct Google Place IDs, phones
and websites. They were held from Batch 4 by the original guard and published after the importer change (`5215ab4`).

---

## 4. Prepare stock photos

### Reusable steps

1. **Check capacity first.** Count photos per category in `operator-admin/public/images/venues/<category>/` that are
   unused in the target market, and compare with the batch's likely venue mix. Restaurant-type venues dominate
   (San Diego: ~53% Restaurant and Bar), so `casual-dining` and `bar` run out first.
2. **Source only when short.** Wayne downloads free Unsplash photos (normal Download button in Chrome) to
   `~/Downloads/hhc-stock-photos/` with a manifest CSV (`unsplash_id, category, photographer, photo_page_url,
   description`). Automated Unsplash access returned HTTP 403 — don't retry it.
3. **Match every file to the manifest** by Unsplash ID; flag anything unmatched.
4. **Duplicate checks** against the whole library and within the download: exact SHA-256, perceptual dHash (whole frame
   and centre crop), then a **visual comparison** against contact sheets — hashes miss crops and alternate frames.
5. **Reject** duplicates and near-duplicates, prominent brand logos or readable venue signage, recognisable other cities,
   black-and-white shots in this all-colour library, and weak fits.
6. **Optimize into the library:** progressive JPEG, longest side 1,600 px, 4:2:0, metadata stripped, ~70–360 KB, fresh
   names continuing the category (`venue-pic-<category>-<N>.jpg`). Leave originals untouched.
7. **Record sources** in `docs/operations/stock-photos/<name>-sources.csv` (Unsplash ID, photographer, page URL,
   original hash, decision, library path, reason) — accepted **and** rejected.
8. **Check every new photo renders at listing-card size**; mark weak shots as last resort.
9. **Release:** commit photos + source CSV on `website`, check staging, then promote **only that commit** to `main`
   (cherry-pick; verify the Production diff is exactly those files). Verify every new URL on Production
   (HTTP 200, `image/jpeg`, byte-identical, decodes) **before** publishing any venue that uses them.

### San Diego example

Two downloads: 30 → 21 accepted (4 duplicates incl. a crop of `cocktail-bar-5`, 5 signage), and 30 → 23 accepted
(duplicates of `pub-4`/`pub-10`, Miami skyline, signage, B&W). Weaker shots tried last: `casual-dining-27`, `-31`,
`bar-14`; `pub-2` is excluded (Guinness sign). After 81 venues, `casual-dining` and `bar` are again the short categories.

---

## 5. Import and publish

All commands run from `operator-admin/` unless shown otherwise. Reports go to the gitignored
`operator-admin/scripts/output/import-reports/<csv>.<timestamp>.<dry-run|apply>.json`.

### 5.1 Read-only dry run (any time)

```bash
npm run import:market-venues -- --market=<market-slug> --csv=../docs/operations/<market>/<batch>/<file>.csv
```

Expected before import: `Summary: insert N · skip (existing) 0 · blocked 0` and
`Business hours: N eligible · 0 ineligible | City assignment: N resolved · 0 blocked`.
Reconcile the planned inserts against the CSV **slug for slug** (the report's `rows[].wouldInsert`), and confirm every
insert is `is_published: false`, `source: "seed"` with the expected photo. Fix or hold every blocked row.

**→ Wayne approves the draft import** here, after reviewing the batch CSVs and the dry run. Commit the reviewed CSVs first.

### 5.2 Draft import (approval required)

1. Confirm the CSV is byte-identical to the reviewed commit; snapshot every venue row
   (`supabase db query --linked -o json "select id, md5(v::text) as h from public.venues v order by id"`).
2. Re-run the dry run (gate as above), then:
   ```bash
   npm run import:market-venues -- --market=<market-slug> --csv=<same csv> --apply
   ```
   Capture the `INSERTED row … <slug> → <id>` lines and the apply report path.

### 5.3 Draft verification

- Every stored field matches the CSV: name, type, address, phone, links, city/market, coordinates, business hours,
  `hh_times`, tagline, offers, photo path, Place ID, rating, review count.
- All are unpublished, `source = seed`, unclaimed, unverified, not cancelled, no operator linked, no subscription or plan
  grant (Free), empty `search_tags`.
- `seeded_tags` equal the importer's own generator output (`generateSeededTags` from `src/lib/seededTags`) for each row.
- Every assigned photo returns 200 on Production.
- Every pre-existing venue row is byte-identical to the snapshot; held venues are absent.
- Dry run again: `insert 0 · skip (existing) N · blocked 0`.
- Logged out, analytics blocked: drafts absent from browsing, the homepage, name search (in-market and cross-market),
  the sitemap; each draft URL returns 404; the market count is unchanged. Check name-search hits against exact card
  titles — a short name like "Puesto" can match other live locations.

**→ Wayne approves publication** here.

### 5.4 Guarded publish by exact IDs (approval required)

Pre-publish gate per ID: still unpublished, seed, unclaimed, unverified, not cancelled, expected market and city, photo
exists and matches the CSV, qualifying happy hour (`hasQualifyingHappyHour`), unchanged since import, rating as CSV,
empty Search Tags, Free. Then run one transaction (`supabase db query --linked -f <file>.sql`):

```sql
BEGIN;
DO $$
DECLARE n integer;
BEGIN
  WITH targets(id, city_slug) AS (VALUES
      ('<venue-uuid>'::uuid, '<city-slug>') /* , … one row per approved ID */)
  UPDATE public.venues v
     SET is_published = true
    FROM targets t, public.markets m, public.cities c
   WHERE v.id = t.id
     AND v.is_published = false
     AND v.created_by_operator_id IS NULL AND v.updated_by_operator_id IS NULL
     AND v.claimed_at IS NULL AND v.claimed_by IS NULL
     AND v.is_verified = false AND v.cancelled_at IS NULL
     AND v.source = 'seed'
     AND m.id = v.market_id AND m.slug = '<market-slug>'
     AND c.id = v.city_id AND c.slug = t.city_slug
     AND v.placeholder_image_path IS NOT NULL AND v.hh_times IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> <N> THEN RAISE EXCEPTION 'expected exactly <N> venues published, got % — nothing applied', n; END IF;

  INSERT INTO public.audit_logs (actor_email, action, entity_type, entity_id, entity_name, details_json)
  VALUES ('<approver email>', 'venue_bulk_published', 'venue_batch', NULL, '<Market name>',
          jsonb_build_object('count', <N>, 'market', '<market-slug>', 'batch', '<batch-label>',
            'venue_ids', jsonb_build_array('<venue-uuid>' /* , … */),
            'via', 'Claude Code, approved by Wayne; mirrors qaPublishImportedVenuesAction'));
END $$;
SELECT count(*) FILTER (WHERE is_published) AS published_now, count(*) AS targeted
  FROM public.venues WHERE id IN ('<venue-uuid>' /* , … */);
COMMIT;
```

Expected: `published_now = targeted = N`. Then verify only `is_published` and the automatic `updated_at` changed on the
N rows, every other venue is byte-identical, and the newest `venue_bulk_published` audit row lists the N IDs.

### 5.5 Logged-out Production checks (analytics blocked, venue's local time zone)

- Each new page: HTTP 200 + canonical URL, name and city, stock photo (page + `og:image`), Google rating badge and review
  count (`4` renders as `4.0`), all 7 days of happy hour and business hours as reviewed (closed days may render
  uppercase), every offer with its price, no Verified badge.
- Browsing shows the new market total with every venue as a card; map pins for all; name search finds each new venue
  in-market and cross-market (and an exact full-name search returns that exact listing); the sitemap lists every new URL;
  no held venue appears anywhere.

### Resuming after an interruption

- Keep multi-hour batch work in a durable folder outside the repo — **`~/hhc-work/<batch>/`** — because the session
  scratchpad under `/tmp` is wiped when the machine restarts. Screening workers rewrite their JSON after every venue,
  so a resumed worker reads its file and continues.
- The current working tools live in `~/hhc-work/gsd-batch4/` (not committed): `BRIEF4.md` (screening brief),
  `build_batch4.py` (CSV builder), `tools/render_page.cjs`, `tools/pdf_render.cjs`, `tools/tagcheck.ts`,
  `tools/block_script.cjs`, `tools/draft_check.cjs`, `publish/prepublish.ts`, `publish/expected.ts`,
  `publish/publish_check.cjs`.
- **Latest data:** committed import + review CSVs in `docs/operations/<market>/<batch>/`; run reports in
  `operator-admin/scripts/output/import-reports/`. The DB is the source of truth for what's live — re-run the read-only
  dry run (it shows which rows already exist) before resuming any write step.

---

## Checklist — next West Coast market

1. [ ] Confirm the market and its cities with Wayne; build the roster file with targets and Google-verified aliases;
   generate and dry-run the cities SQL (apply only with approval).
2. [ ] Count live venues; rank areas by coverage, local dining and visitor demand; record the evidence.
3. [ ] Check stock photo capacity by category for the first batch; source and release photos to Production first if short.
4. [ ] Screen ~2–3× the batch size from venue-owned sources; second look; independent recheck of holds.
5. [ ] Build import + review CSVs (only qualifying rows; exact Place IDs, Census pins, fit-based photos, reviewed
   shared addresses only); dry run clean and reconciled.
6. [ ] Wayne approves the draft import → import → verify drafts (fields, tags, photos, unchanged rows, absent from public).
7. [ ] Wayne approves publication → guarded publish by exact IDs with audit event → logged-out Production checks.
8. [ ] Commit the CSVs; update the research list with holds and recheck dates. Close seeding when Wayne judges the
   geographic coverage sufficient for launch (as with San Diego at 81), not to hit a number; keep remaining gaps and
   holds as context for later rounds.
