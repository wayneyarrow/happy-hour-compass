# Market Content Seeding Playbook — Daily Specials and Recurring Events

How to seed **Daily Specials** and **recurring Events** for venues that are already seeded and published in a market — from
research to live listings. Companion to the venue workflow in [`MARKET_SEEDING_PLAYBOOK.md`](MARKET_SEEDING_PLAYBOOK.md):
the same ground rules, approval gates and logged-out checks apply. Written from the Greater San Diego (GSD) release on
2026-11-15 (99 Daily Specials, 39 recurring event rows / 33 series). GSD-specific choices are kept in
[Release history](#release-history--greater-san-diego-2026-11-15); everything above it is the reusable default.

**Ground rules (same as venues)**

- **One shared database.** Staging and Production use one Supabase project. Reads are fine any time; **every write needs
  Wayne's explicit approval for that specific step**: image upload, draft import, publish, rollback, Storage cleanup.
- **Venue-owned evidence only.** The venue's own website, menus, PDFs, image menus and venue-run event calendars verify
  facts. Guides and directories are leads only. Instagram/Facebook pages can't be read logged-out — content that exists
  only there is a coverage gap, never verified, and never worked around.
- **Never work around a block** (403, 429, captcha): hold the venue as `blocked`; don't retry it.
- **Only seeded, unclaimed venues.** Content is added only to `source = 'seed'`, published, unclaimed, operator-free,
  uncancelled venues in the market. Every SQL write re-checks this at run time.
- **Never publish what the app can't show truthfully.** If the schedule, time or price can't be represented accurately,
  hold the row and say why.

**Tools** (all in the repo; run from `operator-admin/` unless noted)

| Tool | Purpose | Writes? |
|---|---|---|
| `scripts/seeding/renderVenuePage.cjs`, `renderMenuPdf.cjs` | Research: page text + screenshots, PDF pages | work folder only |
| `scripts/seeding/contentSeedBatch.ts` | `build` · `dry-run` · `sql` · `replay` · `image-manifest` · `upload-images` · `verify` · `storage-objects` | Storage only with `--apply`; SQL files are run separately |
| `scripts/seeding/prepEventImages.cjs` | Event photos: verify downloads, prepare JPEGs, crops, contact sheet, source-record draft | work folder only |
| `scripts/seeding/checkDailySpecials.ts` | Logged-out Production check, `--stage=draft` (hidden) or `published` | no (browser GETs) |
| `scripts/seeding/checkEvents.ts` | Logged-out Production check for event pages, venue pages, `/website-events`, sitemap | no (browser GETs) |
| `scripts/seeding/contentSqlHarness.mjs` | Runs a batch's apply/publish/rollback SQL against in-memory PGlite (never Supabase) | no |
| `src/lib/seeding/contentSeed.ts` | Pure helpers: series expansion, first dates, slugs, SQL builders (unit-tested) | — |
| `tests/unit/seeding/contentSeed.test.ts` | Unit tests incl. a replay of the committed GSD inputs | — |

Requirements: `operator-admin/.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (read-only commands
and `upload-images`); the Supabase CLI linked to the project (`supabase/.temp/project-ref` = `juphyhxdmcvseeufbiay`) for
running SQL files; Playwright browsers for the logged-out checks. `build --offline`, `sql`, `replay`, `image-manifest`
and the unit tests need no credentials.

Keep work in progress in a durable folder outside the repo (e.g. `~/hhc-work/<market>-content/`); the session scratchpad
under `/tmp` is wiped on restart. Committed records live in `docs/operations/<market>/events-batch<N>/` and
`specials-batch<N>/`.

---

## 1. Research

### 1.1 List the eligible venues (read-only)

From the repo root:

```bash
supabase db query --linked "select v.slug, v.name, c.name as city, v.website_url, v.menu_url
  from public.venues v join public.markets m on m.id = v.market_id join public.cities c on c.id = v.city_id
  where m.slug = '<market-slug>' and v.is_published and v.source = 'seed' and v.claimed_at is null
    and v.created_by_operator_id is null and v.cancelled_at is null order by c.name, v.name"
```

Also note existing content so you don't duplicate it:
`select count(*) from public.events e join public.venues v on v.id = e.venue_id join public.markets m on m.id = v.market_id where m.slug = '<market-slug>'`
(same for `public.daily_specials`).

### 1.2 Read every venue's own pages

For each venue: the homepage, the menu URL, and every same-site page whose link text or URL says specials, deals,
weekly, happenings, events, entertainment, live music, calendar, trivia, karaoke, brunch. Render pages, don't just fetch
HTML — many calendars and specials boards are JavaScript widgets (Spotapps "specials" pages, The Events Calendar,
Wix/BentoBox event lists) and many specials are images:

```bash
node operator-admin/scripts/seeding/renderVenuePage.cjs "<url>" <work dir>/pages/<venue-slug>-<n>   # from the repo root
node operator-admin/scripts/seeding/renderMenuPdf.cjs  "<pdf url>" <work dir>/pages/<venue-slug>-pdf
```

Read `text.txt` **and** the `slice-N.png` screenshots (image-only entertainment posters, specials boards). Open event
detail pages for times and recurrence ("Event Series", "Every Wednesday", "View all N dates"); a calendar listing alone
doesn't prove a weekly series.

**Second pass (always).** After the first pass, recheck every venue with no recurring event or no special, treating the
first notes as leads only: follow *every* same-site link, embedded calendars and event-detail pages, and look for
structured event data. In GSD the second pass found a venue's whole weekly calendar (7 series) that the first pass missed.

### 1.3 Record evidence for every fact

Every row keeps: `source_url` (the page that states it), an `evidence` quote (exact wording; add "(image)" for text read
from a screenshot or poster), and `verified_on` (the research date, YYYY-MM-DD, market-local). Daily Specials store
`source_url` and `last_verified_at` in the database; events keep them in the batch record.

### 1.4 Classify: Daily Special, Event, happy hour, or neither

| It is… | When | Goes to |
|---|---|---|
| **Happy hour** | The venue calls it happy hour, including "all-day happy hour Monday" and day-specific HH menus | the venue's `hh_times` (venue workflow), never a special |
| **Daily Special** | A day-specific food/drink offer with a stated price or discount ("Taco Tuesday $3 tacos", "½ off bottles of wine Wednesday", "$25 bottomless mimosas Sunday") | `daily_specials` |
| **Event** | Entertainment or an activity at a time: live music, DJ, trivia, karaoke, bingo, drag shows, game nights, comedy | `events` |
| **Neither** | Holiday menus and buffets (Thanksgiving, NYE), plain brunch/service hours, private/ticketed-member or hotel-guest-only events, sold-out events, non-food promos (bowling, rides, valet), charity days, unpriced "rotating specials" | not seeded |

- A special that is the same as a stored happy-hour item/window is a duplicate — leave it in happy hour.
- A restricted-audience offer is fine with the restriction in `conditions` and the summary (e.g. hospitality-industry or
  student nights).
- Brand-wide pages ("participating locations") count only if the venue's own location page states the offer; otherwise hold.
- Event `event_type` must be one of `live_music, dj_dance, trivia, karaoke, comedy, sports, food_drink, wine_tasting, community, other`.

### 1.5 Conflicts and unverified details

- **Times must fit the venue's posted hours.** The dry run blocks any special or event that ends after the venue's close
  and any special on a day the venue is closed. If a listing's window conflicts with posted hours (e.g. a specials feed
  showing a uniform "10 AM–11 PM"), never pick a side without a dated reason: keep the day, and either drop the time
  (only when the listed window covered the whole open day) or end at "Close"; otherwise hold.
- **Dropped time = no time line.** A special with `time_mode = unspecified` shows only "Every Monday" — never "All Day" —
  and specials have no "available now" filter. If the offer is limited to part of an open day, dropping the time would
  overstate it: **hold** the row instead.
- **Conflicting pages:** a newer dated source wins; otherwise keep only what all venue pages agree on.
- **Missing price** (specials) or **missing time** (events): hold as `needs_info`. An event's start time is required.
- **Unpriced "special" or a deal that's really the HH menu:** don't seed.

### 1.6 Recurring schedules the app can't represent — hold them

Events support exactly one shape for recurrence: `recurrence = 'weekly'`, one row per weekday, no end date and no
exceptions (`monthly` only renders "Monthly"). So:

- **Weekly on one or more weekdays** → seed (one row per weekday).
- **Monthly patterns** ("third Thursday", "last Saturday"), **seasonal runs**, **series with an end date or skipped weeks**
  → not a recurring event. Hold it (one-off dated events are a separate workflow).
- A daily special with a stated end date can use `recurrence_end_date` only if you extend the tooling; by default hold
  seasonal offers without a stated end (they'd go stale).

---

## 2. Build the batches

### 2.1 Input CSVs (one per batch, committed)

**Events — `input-events.csv`: one row per series** (or per time window when a series' time differs by day):

| Column | Rules |
|---|---|
| `venue_slug` | an eligible venue (1.1) |
| `title` | the venue's own event title |
| `event_type` | one of the event types above |
| `days` | `;`-separated weekdays: `sun mon tue wed thu fri sat` (full names and `0–6` also accepted) |
| `start_time` | required, `7:00 PM` form (app's text format) |
| `end_time` | optional, same form; blank if unknown or past posted close |
| `description` | one or two sentences, generic and factual |
| `teaser` | optional, usually blank |
| `price_display` | optional: "Free", "$15–$20", "$15 cover after 10 PM" |
| `age_restriction` | optional: "18+", "21+" |
| `image_slot` | e.g. `TRIVIA-2` (see 3) |
| `source_url`, `evidence`, `note`, `verified_on` | evidence (1.3); `verified_on` = YYYY-MM-DD |

**Daily Specials — `input-specials.csv`: one row per offer:**

| Column | Rules |
|---|---|
| `venue_slug`, `title` | as above (title must be unique per venue) |
| `offer_type` | `food`, `drink` or `food_drink` |
| `days` | as above |
| `time_mode` | `unspecified`, `all_day` or `timed` |
| `start_time` | `HH:MM` (24 h) for `timed`; blank otherwise |
| `end_mode` | `unspecified`, `time` or `close` (`close` = until the venue closes — never a clock time) |
| `end_time` | `HH:MM` only when `end_mode = time` (may be earlier than start = after midnight) |
| `short_summary` | ≤ 120 characters, with the price/discount ("$2 off wings every Wednesday.") |
| `description` | optional longer detail (≤ app limit) |
| `conditions` | optional, guest-visible restrictions ("Dine-in only.", "For hospitality-industry workers.") |
| `source_url`, `evidence`, `decision`, `note`, `verified_on` | `decision` records any judgment call and its outcome |

Unknown or missing columns stop the build. Keep held/excluded rows out of the inputs and list them in `held.csv`
(`venue_slug,title,reason` for events; add `status` = held/excluded for specials).

### 2.2 How series become database rows

`build` expands each series into **one `events` row per weekday** (the Central Okanagan shape):

- `recurrence = 'weekly'`, `event_frequency = "Every <Weekday>"`, `event_time = "<start> – <end>"` (or just start),
  `first_date` = the **first occurrence on or after the as-of date**, which is **market-local today on import day**.
- `slug = <venue-slug>-<slugified title>`, plus `-<weekday>s` (e.g. `-fridays`) when the same venue + title runs on more
  than one weekday — so every row is unique and stable.
- Recurring events always display regardless of `first_date`; first dates only matter for ordering and the
  "next occurrence" labels, so build on the day you import (`--timezone=<market zone>` or an explicit `--as-of`).

### 2.3 Build (writes `batch.json` + `review.csv`; reads venue IDs, read-only)

```bash
cd operator-admin
npx tsx scripts/seeding/contentSeedBatch.ts build --kind=specials --market=<market-slug> \
  --input=../docs/operations/<market>/specials-batch1/input-specials.csv --out=../docs/operations/<market>/specials-batch1 \
  --timezone=<IANA zone, e.g. America/Los_Angeles> --held=../docs/operations/<market>/specials-batch1/held.csv
npx tsx scripts/seeding/contentSeedBatch.ts build --kind=events --market=<market-slug> \
  --input=../docs/operations/<market>/events-batch1/input-events.csv --out=../docs/operations/<market>/events-batch1 \
  --timezone=<IANA zone> --images=<work dir>/images/prep-report.json --held=../docs/operations/<market>/events-batch1/held.csv
```

Expected: `Built <N> specials rows as-of <date> → …/batch.json` and `Built <N> events rows (<S> series) as-of <date> → …`.
Any `image spacing:` line means the image assignment needs fixing (3.4). `--replace-slots=A,B` marks rejected images
(their rows block until replaced).

**Stable IDs on every rebuild.** After the first build, always rebuild with `--reuse=<the previous batch.json>`: event and
special IDs, event Storage paths and slugs are carried over by key (`venue_slug|title|weekday` / `venue_slug|title`), so
reviewed files, uploaded images and imported drafts keep matching. Copy the previous `batch.json` aside first (the build
overwrites it). Only genuinely new rows get new IDs.

### 2.4 Dry run (read-only; writes the SQL files for review)

```bash
npx tsx scripts/seeding/contentSeedBatch.ts dry-run --batch=../docs/operations/<market>/specials-batch1/batch.json --approver=<approver email>
npx tsx scripts/seeding/contentSeedBatch.ts dry-run --batch=../docs/operations/<market>/events-batch1/batch.json --approver=<approver email> \
  --images-dir=<work dir>/images/prepared
```

Expected: `Summary: specials insert N · blocked 0 · venues V` / `Summary: events insert N · blocked 0 · venues V · series S`,
a `By city:` line, then `SQL written (not run): …/apply.sql · publish.sql · rollback.sql — N rows`. Only unblocked rows
go into the SQL. Report: `dry-run.<timestamp>.json` in the batch folder (scratch — don't commit).

What blocks a row: venue not an eligible seed; venue/ID mismatch; duplicate id/slug/title in the batch or the database;
slug in `event_slug_history`; first date not the next occurrence; bad event type/time; event or special ending after the
venue's close; a special on a closed day; any app validator error (`validateDailySpecialSchedule`, `…Time`, `…Content`,
e.g. summary > 120 characters); an event image not `ok` or (with `--images-dir`) a local file whose hash changed.
Warnings to read: start outside hours, "ends after midnight" (displays as a plain range like "11 PM–1 AM"; day filters use
the start day), "mentions happy hour", "no price/discount wording", no description.

Fix inputs, rebuild with `--reuse`, re-run until `blocked 0` (or hold the row).

### 2.5 Review before approval

Bring Wayne: the review CSVs, counts by city and day, the held list with reasons, every `decision` judgment call with a
recommendation, and (events) the crop sheet. **Commit the input CSVs, `held.csv`, `batch.json`, `review.csv` and the SQL
files once approved.**

---

## 3. Event images

### 3.1 Plan slots

Group the series by image type (trivia, dj, live-music, karaoke, drag, bingo, games, …) and assign slot IDs
`<TYPE>-<n>` so that **an image never repeats on the same weekday** (cards from different venues sit side by side) and
**never repeats at one venue** (a venue page lists all its events). One series on several weekdays keeps one image.
The minimum per type is the largest number of same-type series on any one weekday. `build` and `dry-run` print
`image spacing:` lines for violations.

### 3.2 Hand off to the image-sourcing session (regular Claude in Chrome)

Images are downloaded by Wayne's Claude-in-Chrome session (the `hhc-image-sourcing` skill), not by Claude Code —
automated Unsplash access is blocked. Send it a brief like:

> Download free **Unsplash** photos (Unsplash License only — not Unsplash+) for these Happy Hour Compass event slots.
> Save each as `<SLOT>.jpg` in `~/Downloads/hhc-stock-photos/` and write `~/Downloads/hhc-stock-photos/<market>-event-images-<date>.csv`
> with columns `slot_id, filename, unsplash_id, photo_page_url, photographer, photographer_profile, licence,
> attribution_required, suggested_credit, match, review_note`.
> Rules: colour; landscape preferred; ≥ 3000 px long side; generic imagery that fits the activity without implying it
> shows the actual venue or performer — prefer detail, partial-face, silhouette or from-behind shots of performers; no
> readable signage, venue names or prominent brand logos; no recognisable city skyline; no parades/protests.
> Slots: `TRIVIA-1` — answer sheets and pencils on a pub table (*"pub quiz table answer sheet beer"*); `DJ-1` — DJ hands on
> decks under club lights, no legible brand (*"dj hands mixer neon lights"*); … (one line per slot, with a search phrase).

Replacements use the same file name and a separate `<…>-replacements.csv` with the same columns.

### 3.3 Prepare and review (local only)

Copy the downloads into the work folder if you like (the originals stay in Downloads), then:

```bash
cd operator-admin
node scripts/seeding/prepEventImages.cjs --src=<downloads dir> --csv=<download csv> --out=<work dir>/images --library=public/images
```

Expected: one line per slot (`TRIVIA-1  5760x3840 -> 1600x1067 227KB prog=true 4:2:0 exif=false event-pic-trivia-1.jpg`)
and `"problems": []`. It exits 1 on a missing/extra/misnamed file. Outputs: `prepared/event-pic-<type>-<n>.jpg`
(progressive JPEG, longest side 1600 px, 4:2:0, metadata stripped), `crops/<slot>-card|mobile|hero.jpg` (360×200,
340×200, 800×260 — the centre crops the site shows), `sheet-cards.jpg`, `prep-report.json`, `sources-draft.csv`.

Review **every** image at full size and in the card + hero crops: readable venue signage or names (reject — in GSD a
"Jack Solomons Jazz Club" neon sign; cropping it out cut off the band), prominent logos (small equipment marks legible
only at full size are acceptable), identifiable people who could be mistaken for the advertised performer (flag), and
weak fit. Fill `decision` (`accepted`, `rejected — <why>`, `accepted — approved by Wayne`) and `reason` in
`sources-draft.csv` and save it as `docs/operations/stock-photos/<source>-<date>-<market>-events-sources.csv`
(accepted **and** rejected rows). **Owner-approved exceptions** (e.g. Wayne keeps a flagged photo) are recorded in
`decision` + `reason` with the date — never silently.

### 3.4 Manifest

```bash
npx tsx scripts/seeding/contentSeedBatch.ts image-manifest --batch=../docs/operations/<market>/events-batch1/batch.json \
  --sources=../docs/operations/stock-photos/<…>-events-sources.csv
```

Writes `image-manifest.csv`: slot, decision, prepared file + SHA-256, Unsplash ID, photographer, licence, event ID, venue,
title, schedule, **Storage path** and final URL — one line per event row. It fails if a slot is missing from the sources
CSV or its hash differs from the batch.

### 3.5 Why each event row gets its own Storage object

Event images live in the `venue-images` bucket at `events/<eventId>/<uuid>.jpg` (the path Operator Admin uses). When an
operator removes an event's image in Operator Admin, the app **deletes that Storage file**
(`removeEventImageAction`). If one file were shared across rows — worse, across venues — one operator's removal would
break other listings. So the batch gives **every event row its own object**, even when rows share a source photo
(e.g. 39 objects from 19 photos). Paths are generated once and kept by `--reuse`.

---

## 4. Approval-gated steps

Each step runs only after Wayne approves **that** step. Do them in this order; specials don't depend on images.

### 4.1 Pre-flight (every time, read-only)

1. Rebuild with `--reuse` on the day you import (first dates) and re-run the dry run — `blocked 0`.
2. Optional, recommended: run the SQL through the in-memory harness (never touches Supabase):
   ```bash
   cd operator-admin && npm i --no-save @electric-sql/pglite
   node scripts/seeding/contentSqlHarness.mjs ../docs/operations/<market>/events-batch1 ../docs/operations/<market>/specials-batch1
   ```
   Expected: `PASS` lines and `N/N checks passed` (apply/re-run refused/publish/audit/rollback, claimed-venue and
   operator-edit refusals, slug-history refusal).
3. Snapshot the table you're about to change (all rows) so you can prove nothing else changed, e.g.
   `supabase db query --linked "select count(*), count(*) filter (where is_published) from public.daily_specials"` plus a
   full export with the read-only service client, and note the newest `audit_logs` row.
4. Confirm the linked project: `cat supabase/.temp/project-ref` → `juphyhxdmcvseeufbiay`, and a read-only
   `supabase db query --linked "select count(*) from public.daily_specials"` matches your snapshot.

### 4.2 Event image upload (approval) → verify

```bash
cd operator-admin
npx tsx scripts/seeding/contentSeedBatch.ts upload-images --batch=../docs/operations/<market>/events-batch1/batch.json --images-dir=<work dir>/images/prepared          # dry run: "would upload …"
npx tsx scripts/seeding/contentSeedBatch.ts upload-images --batch=…/events-batch1/batch.json --images-dir=<work dir>/images/prepared --apply  # after approval
npx tsx scripts/seeding/contentSeedBatch.ts verify --batch=…/events-batch1/batch.json --stage=images
```

Expected: one `uploaded events/<id>/<uuid>.jpg` per row (uploads use `upsert: false`, so nothing is overwritten), then
`IMAGES VERIFY: ALL PASS (N rows)` (each public URL returns 200, `image/jpeg`, byte-identical to the prepared file).
Upload refuses if a local file's hash differs from the batch.

### 4.3 Draft import (approval) → verify → hidden check

From the repo root, after approval:

```bash
supabase db query --linked -f docs/operations/<market>/<kind>-batch1/apply.sql
```

Expected: `"drafts_inserted": N`. The SQL is one transaction: each row inserts only if its venue is still an eligible seed
and no duplicate (same venue + title [+ weekday], same slug, slug in history) exists; any miss raises and **nothing** is
applied. Then (from `operator-admin/`):

```bash
cut -d, -f1 ../docs/operations/<market>/<kind>-batch1/review.csv | tail -n +2 > ../docs/operations/<market>/<kind>-batch1/imported-ids.txt
npx tsx scripts/seeding/contentSeedBatch.ts verify --batch=…/<kind>-batch1/batch.json --stage=draft
npx tsx scripts/seeding/checkDailySpecials.ts --base=https://happyhourcompass.com --batch=…/specials-batch1/batch.json --stage=draft
npx tsx scripts/seeding/checkEvents.ts --base=https://happyhourcompass.com --batch=…/events-batch1/batch.json --ids=…/events-batch1/imported-ids.txt --stage=draft
```

(`imported-ids.txt` must list exactly the IDs in `apply.sql` — for events, rows whose image is `ok`.) Expected:
`DRAFT VERIFY: ALL PASS (N rows)` (every field equals the batch; unpublished; seeded; no operator attribution); your
snapshot diff shows exactly the N new IDs and **0 other rows changed**; the logged-out checks end `N/N passed`:

- specials: none of the batch IDs on any batch venue page, the market's `/website-daily-specials`, the market homepage,
  or the cross-market specials page;
- events: every `/{market}/{city}/events/{slug}` and `/website-events/{id}` returns 404; no batch venue page, market
  `/website-events`, market homepage or cross-market events page links a batch event; none in the sitemap.

### 4.4 Publish (approval) → verify → published checks

Confirm `publish.sql` targets exactly `imported-ids.txt`, then from the repo root:

```bash
supabase db query --linked -f docs/operations/<market>/<kind>-batch1/publish.sql
```

Expected: `"published_now": N, "targeted": N`. The update sets only `is_published` on exactly those IDs, only where the row
is still an unpublished seeded row with **no operator attribution** (`created_by_operator_id`/`updated_by_operator_id`
null) and the venue is still an eligible seed; unless **exactly N** rows change it raises and nothing is published. It
writes one `event_bulk_published` / `daily_special_bulk_published` audit row with the IDs. Then:

```bash
npx tsx scripts/seeding/contentSeedBatch.ts verify --batch=…/<kind>-batch1/batch.json --stage=published
npx tsx scripts/seeding/checkDailySpecials.ts --base=https://happyhourcompass.com --batch=…/specials-batch1/batch.json --ids=…/specials-batch1/imported-ids.txt --stage=published
npx tsx scripts/seeding/checkEvents.ts --base=https://happyhourcompass.com --batch=…/events-batch1/batch.json --ids=…/events-batch1/imported-ids.txt --stage=published
```

Expected: `PUBLISHED VERIFY: ALL PASS (N rows)`; snapshot diff = only the N rows, only `is_published` + `updated_at`; one
new audit row with count N; logged-out checks `N/N passed`:

- specials: every batch venue page shows each of its specials (`id="daily-special-<id>"` + title); the market's
  `/website-daily-specials` links all N and its count matches;
- events: every event URL returns 200 with its title and `og:image` = the batch image URL; each venue page links its
  events; the market `/website-events` links all N ("N events"); all in the sitemap.

Also re-run a published check against a few existing listings in another market (e.g. two Central Okanagan specials /
events in a small `--batch` file) to confirm nothing else moved. The homepage lines are informational: Today's Specials
shows only today's specials, and a market homepage may have no specials/events rail at all.

Record what ran in the batch folder: `apply-report.json` (approval, SQL hashes, counts, verify and check results, held
rows) and `imported-ids.txt`. Commit them.

### 4.5 Resuming after a partial run

The database is the source of truth. Re-run the read-only commands to see where you are:

| Situation | Do |
|---|---|
| Some images uploaded | `verify --stage=images` lists what's missing; re-run `upload-images --apply` — existing objects error "already exists" (upsert is off) and are left as they are; re-verify |
| `apply.sql` failed | Nothing was applied (single transaction). Read the guard message (`guard failed for <slug>`), fix, rebuild with `--reuse`, dry-run, re-approve |
| Drafts in, verification failed | `verify --stage=draft` shows the field; fix the cause and either rollback + re-import (approval) or report |
| `publish.sql` failed | Nothing was published (exact-N guard). Usually an operator edited a draft or a venue was claimed — find it with `verify --stage=draft`, remove it from the batch (rebuild with `--reuse`, regenerate SQL with `dry-run`), re-approve |
| Session lost | Committed `batch.json` + `imported-ids.txt` + `apply-report.json` say what ran; `verify` tells you the current state |

---

## 5. Guards, rollback and Storage cleanup

**Guards (built into the SQL; covered by unit tests and the harness):** exact IDs; venue still a published, unclaimed,
operator-free, uncancelled seed in the market; no duplicate venue/title(/weekday), slug or historical slug; single
transaction with per-row `ROW_COUNT` checks; publish only touches unpublished seeded rows with no operator attribution and
must change exactly N rows; one audit row per publish.

**Rollback (approval)** — `rollback.sql` deletes only the batch IDs that are still seeded rows with no operator
attribution; anything an operator has edited is kept (handle it with the operator). From the repo root:

```bash
supabase db query --linked -f docs/operations/<market>/<kind>-batch1/rollback.sql
```

**Event images are not removed by SQL.** List the batch's objects, then (after approval) delete only those whose event
row no longer exists:

```bash
cd operator-admin
npx tsx scripts/seeding/contentSeedBatch.ts storage-objects --batch=…/events-batch1/batch.json                  # list
npx tsx scripts/seeding/contentSeedBatch.ts storage-objects --batch=…/events-batch1/batch.json --remove          # dry run
npx tsx scripts/seeding/contentSeedBatch.ts storage-objects --batch=…/events-batch1/batch.json --remove --apply  # after approval
```

The paths are also in `image-manifest.csv` (`storage_path` column, bucket `venue-images`).

---

## 6. Offline validation of committed records (no credentials)

From a clean checkout (`npm ci` in `operator-admin/`):

```bash
cd operator-admin
npx tsx --test tests/unit/seeding/*.test.ts
npx tsx scripts/seeding/contentSeedBatch.ts replay --dir=../docs/operations/<market>/events-batch1   --approver=<approver email used>
npx tsx scripts/seeding/contentSeedBatch.ts replay --dir=../docs/operations/<market>/specials-batch1 --approver=<approver email used>
npm i --no-save @electric-sql/pglite && node scripts/seeding/contentSqlHarness.mjs ../docs/operations/<market>/events-batch1 ../docs/operations/<market>/specials-batch1
```

`replay` rebuilds the batch offline from the committed input CSV with the committed IDs and as-of date and regenerates the
SQL. Expected: `REPLAY events: OK — N rows rebuilt identically from input-events.csv; apply/publish/rollback statements match`.

---

## Release history — Greater San Diego (2026-11-15)

Records: [`greater-san-diego/specials-batch1/`](greater-san-diego/specials-batch1/),
[`greater-san-diego/events-batch1/`](greater-san-diego/events-batch1/),
[`stock-photos/unsplash-2026-11-15-gsd-events-sources.csv`](stock-photos/unsplash-2026-11-15-gsd-events-sources.csv).

- **Research:** 80 eligible seeded venues (81 published minus one operator-owned). First pass over venue sites, then a
  second pass on the 62 venues without a recurring event; Bellamy's (403) held as blocked, McP's lineup is
  Facebook-only. Template: the Central Okanagan rows (2026-03 and 2026-10-23 refresh), built ad hoc at the time.
- **Daily Specials:** 99 published at 43 venues (San Diego 56, Chula Vista 15, La Mesa 13, Escondido 5, Solana Beach 4,
  Lakeside 2; Encinitas, Oceanside, Carlsbad, San Marcos 1 each). Drafts 2026-11-15 ~15:30 UTC, published 15:41 UTC.
  Approved judgment calls: Savoie Sunday-only mimosas (the $25 price is stated for Sunday only), Waterbar Oyster
  Wednesday, The 3rd Corner no-corkage Thursday, The Duck Dive Industry Night (hospitality workers, in `conditions`),
  Puesto Mission Valley Taco Tuesday without a time, Tahona $1 Monday oysters, Duck Dive specials read from the venue's
  specials image (uploaded 2026-04). Time fixes: Gaslamp (Mon–Thu) and Pillbox (Wed/Thu) times dropped because the
  listed window conflicted with posted hours but covered the whole open day; Rabbit Hole Taco Tuesday and The Local
  Thursday Club end at Close.
- **Held specials (13) / excluded (2)** — `specials-batch1/held.csv`: Gaslamp **Friday Specials** (listed to 11 PM, open to
  1:30 AM — would read as all night), Knotty Barrel football pints (seasonal, no end date), 11 needing a price or a
  location confirmation (incl. Dirty Birds' brand-wide page, JRDN Tuesday/Wednesday conflict); excluded Gossip Grill
  Monday spaghetti (venue closed Mondays) and Urban Mo's Friday martinis (duplicate of happy hour).
- **Events:** 39 rows / 33 weekly series at 18 venues (San Diego 30, Chula Vista 2, Encinitas 2, Lakeside 2, La Mesa 1,
  National City 1, Oceanside 1) — by image type 11 trivia, 8 DJ, 5 live music, 5 karaoke, 2 drag, 1 bingo, 1 game night
  (Carnitas' "Live Music at the Shack" is `live_music` with DJ imagery). First dates as of 2026-11-15 (Sunday rows started that day). 39 Storage
  objects uploaded, drafts imported and published 2026-11-15 (published 16:07 UTC).
- **Held events:** Common Theory Trivia Mondays (weekly but skips Dec 28 and Jan 4 and is only confirmed to Feb 8 — no end
  date/exceptions in the app), plus 8 series with no published start time (Vigilucci's piano, Hacienda Cazadores
  mariachi, The Riviera's lineup, Cafe La Maze ×4, Veranda Bar). Monthly events (e.g. Gossip Grill Wine Club, Kings Club)
  were out of scope.
- **Photos:** 20 Unsplash downloads → 19 used. LIVE-3 rejected (readable "Jack Solomons Jazz Club" sign) — the Rabbit
  Hole's Saturday show uses LIVE-2 instead (no same-night clash). **Owner-approved exceptions:** DRAG-1 (Dreamgirls Revue)
  and DRAG-2 (Sassy Sunday Funday) show identifiable performers and were flagged for replacement; Wayne approved both
  originals for publication on 2026-11-15 pending his live-site photo QA. KARAOKE-3 kept (reads as a generic band).
- **Gap found:** the GSD homepage has no Today's Specials or events rail, so these listings appear on venue pages and the
  specials/events search pages only.
