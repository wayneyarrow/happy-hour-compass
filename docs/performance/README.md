# Public website performance testing

How to measure the public website (happyhourcompass.com) in a repeatable way, and where the agreed baselines live. The first baseline is from the 2026-10-26 investigation; results are summarized in [`BASELINE_2026-10-26.md`](BASELINE_2026-10-26.md).

## Layout

| Path | What | Committed? |
|---|---|---|
| `operator-admin/scripts/perf/trackingBlockList.cjs` | Single list of analytics/tracking/error requests every test blocks | yes |
| `operator-admin/scripts/perf/lighthouse.cjs` | Lighthouse page-load runs (cold + warm) | yes |
| `operator-admin/scripts/perf/summarize.cjs` | Per-run table, medians, tracking audit, optional CSV | yes |
| `operator-admin/scripts/perf/journeys.cjs` | Browsing journeys (tap → content visible) | yes |
| `operator-admin/scripts/perf/locationChecks.cjs` | Location-permission behaviour (prompt/granted/denied/unavailable/no Permissions API/unsupported) | yes |
| `operator-admin/scripts/perf/visualCheck.cjs` | Mobile + desktop screenshots; verifies every first-viewport image loaded; counts deferred images; CLS | yes |
| `operator-admin/scripts/perf/logSupabaseFetches.cjs` + `summarizeSupabaseFetches.cjs` | Investigation aid: logs Supabase requests made by one server render (preload, no app change) | yes |
| `operator-admin/scripts/perf/heroTiming.cjs` | Homepage HTML timing without a browser: when the hero arrives vs the whole document (several bases measured alternately; `--ua=facebook\|googlebot`) | yes |
| `docs/performance/phase2a-local-2026-10-27/` + [`PHASE2A_HOMEPAGE_STREAMING.md`](PHASE2A_HOMEPAGE_STREAMING.md) | Homepage hero streaming: local before/after timing, Lighthouse, placeholder screenshots, failure and crawler checks | yes |
| `docs/performance/phase1-production-2026-10-27/` + [`PHASE1_PRODUCTION_2026-10-27.md`](PHASE1_PRODUCTION_2026-10-27.md) | Phase 1 measured on Production after release, vs the baseline | yes |
| `docs/performance/phase1-staging-2026-10-27/` | Staging before (`cc293d2`) / after (`67fc9fa`) data for the same change — same environment, directly comparable | yes |
| `docs/performance/phase1-local-2026-10-26/` | Before/after data for the location + image-loading change (local builds): Lighthouse per-run CSVs, journeys, location/analytics checks | yes |
| `docs/performance/baseline-*/` | Compact baseline data (per-run CSV, journey JSONL) | yes |
| `operator-admin/scripts/output/perf/<label>/` | Raw Lighthouse JSON (~600 KB each) | no (gitignored) |

## Prerequisites

- Run from `operator-admin/` (scripts resolve `playwright-core` from its `node_modules`).
- Chrome: defaults to Playwright's Chrome for Testing at `~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` (Chrome 151). Override with `CHROME_PATH=...`. Record the Chrome version with every run.
- Lighthouse is fetched with `npx` (`LH_VERSION`, default `13.5.0`).
- Tests are sequential and low-volume (one page load at a time). Never run load tests against Production.

## Agreed pages and journeys

Pages: `/`, `/website-happy-hours`, `/website-daily-specials`, `/central-okanagan/kelowna/train-station-pub` (image-heavy: 6 operator-uploaded Supabase photos + 2 guide images), `/central-okanagan/kelowna/joey` (typical seeded venue with a local placeholder image).

Journeys (`journeys.cjs`, each timer starts at the tap):

| Id | From → to | End point |
|---|---|---|
| J1 | Homepage → Happy Hours (main-content link) | ≥1 result card visible on `/website-happy-hours` |
| J2 | Happy Hours → first visible venue card | venue `<h1>` visible |
| J3 | Venue → browser Back | result cards visible again |
| J4 | "On Now" chip on, then off | rendered result list changed + next paint |
| J5 | Daily Specials (full load) → first visible venue link | venue `<h1>` visible |

## Running

```bash
cd operator-admin

# Page loads: 3 runs per page, each a cold load (storage reset) then a warm load (HTTP cache kept)
node scripts/perf/lighthouse.cjs --base=https://happyhourcompass.com --runs=3 --label=prod-YYYY-MM-DD
node scripts/perf/summarize.cjs scripts/output/perf/prod-YYYY-MM-DD/lighthouse --csv=../docs/performance/baseline-YYYY-MM-DD/lighthouse-runs.csv

# Journeys: unthrottled and Fast 4G (9 Mbps / 1.5 Mbps / 165 ms, 4x CPU)
node scripts/perf/journeys.cjs --profile=none --runs=3 --out=scripts/output/perf/prod-YYYY-MM-DD/journeys.jsonl
node scripts/perf/journeys.cjs --profile=fast4g --runs=3 --out=scripts/output/perf/prod-YYYY-MM-DD/journeys.jsonl

# Location behaviour
node scripts/perf/locationChecks.cjs --base=https://happyhourcompass.com

# Server response (network floor ≈ 0.16 s from the Pacific Northwest)
for p in / /website-happy-hours /website-daily-specials /central-okanagan/kelowna/train-station-pub /central-okanagan/kelowna/joey; do
  for i in 1 2 3; do curl -s -o /dev/null -H 'accept-encoding: br' -w "%{time_starttransfer} " "https://happyhourcompass.com$p"; done; echo " $p"; done
```

Any base URL works (`--base=http://localhost:3100` for a local `next build && next start`, or staging). Local builds read the shared Supabase project, so tracking blocking matters there too.

### Conditions (keep identical between runs)

- Lighthouse: mobile form factor, `--throttling-method=devtools` (150 ms RTT, 1.6 Mbps down, 4x CPU), performance category only, 60 s load cap, headless Chrome, fresh profile per run.
- **Do not use Lighthouse's default "simulate" mode or PageSpeed Insights FCP/TTFB for this site.** Vercel flushes response headers ~30 ms after the request but sends the HTML body only once the page has rendered (~2.8 s on the homepage). Simulated mode treats header time as server time and under-reports FCP by ~3 s. `htmlEnd` (main document fully received) is the meaningful server measure; Speed Insights "TTFB" has the same limitation.
- Cold-load Happy Hours on 1.6 Mbps can exceed the 60 s cap (no score/TBT): report LCP and bytes, not the score.

### Real-user data (Vercel Speed Insights)

```bash
vercel metrics vercel.speed_insights.lcp_ms -a p75 --group-by route --prod -s 28d \
  -f "request_hostname eq 'happyhourcompass.com'" -f "device_type eq 'mobile'" --scope team_8bFabDMUHQheF2tNTU8Mmf7R
# also: fcp_ms, inp_ms, cls; *_count (sum) for sample sizes
vercel metrics vercel.function_invocation.function_duration_ms -a p50 --group-by route --prod -s 7d \
  -f "request_hostname eq 'happyhourcompass.com'" --scope team_8bFabDMUHQheF2tNTU8Mmf7R
```

Compare equal-length windows that start after a release is fully live.

## Tracking and analytics during tests

Every script blocks the requests in `trackingBlockList.cjs` and reports anything tracking-like that still got a response (`TRACKING AUDIT` line). A run is valid only if the audit reports none. After changing the list, run `node scripts/perf/trackingBlockList.cjs` — it checks sample URLs for Production, staging, `*.vercel.app` deployment URLs and localhost.

Blocked: first-party `/api/track/*` (venue/event views, discovery, search, clicks, saves); GA4 collection (`google-analytics.com`, `analytics.google.com`, `www.google.com/g/collect`, `googletagmanager.com` collect, `doubleclick.net`); Vercel Web Analytics and Speed Insights beacons, which use **per-project randomized first-party paths** (e.g. `/f16ccac995dd8fff/view`, `/a351f4d163e0e851/vitals`), not `/_vercel/*`; Sentry envelopes (`*.sentry.io/api/*`).

Not blockable / not blocked, by design:
- The page request itself: Vercel request logs and function invocations (counted in `vercel.function_invocation.*`). These write nothing to HHC's analytics tables.
- Google Maps JS and Static Maps loads on Happy Hours and venue pages: billed API usage, left unblocked because they are part of the page cost being measured.
- Analytics scripts themselves (`gtag.js`, the Vercel scripts) still download and run; only their beacons are blocked, so the byte and CPU cost stays in the measurement.

Verification after a Production run: `vercel metrics vercel.analytics_pageview.count -a sum --group-by os_name --prod -s <run start>` should not rise by the run's page-load count (the scripts emulate Android).

### Comparability note for the 2026-10-26 baseline

The 2026-10-26 runs used an earlier block list that missed the Vercel randomized beacon paths and Sentry. Those runs sent ~54 Vercel Web Analytics page views, ~92 Sentry envelopes (Lighthouse runs) and 1 GA4 hit to Production. The beacons fire after load and don't affect the measured metrics, so the baseline numbers remain comparable. Later runs use the corrected list.

## Before/after on local builds (when a change isn't deployed yet)

Build the unchanged commit in a separate worktree and the changed tree in place, serve both with `next start` (e.g. `:3101` before, `:3100` after) and run the same scripts against both, sequentially. Build and serve with `NEXT_PUBLIC_SENTRY_DSN=` so local runs send nothing to Sentry. Never rebuild `.next` while a `next start` server is still running from it (the old process keeps serving mismatched chunks; confirm the PID on the port changed). Local results are only comparable with each other, not with Production: the local server is much closer to the database and has no GA script.

`locationChecks.cjs` also records, per scenario, the Near Me chip label/state, the sort chip label, the URL and GA4 `discovery_filtered` pushes. A local build has no GA ID, so GA4 events are silently dropped; to check them, build and serve with a placeholder `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-TEST000000` (collection requests are blocked by the block list, and the placeholder property doesn't exist).

Known limits:
- The Google Maps API key doesn't allow `localhost`, so maps show "AuthFailure" locally and Maps sub-module errors ("Could not load …") appear in e2e. This is identical before and after a change.
- DevTools throttling shares bandwidth evenly between requests and ignores `fetchpriority`, so priority changes can't be measured in the lab; check them with Speed Insights after release.
- The cross-browser e2e suite (`npx playwright test`, `BASE_URL=... E2E_INTERCEPT_TRACKING=1`) is noisy against a local `next start`: WebKit/mobile Safari fail on localhost-only issues (cancelled `/_vercel/*` scripts, access-control errors), and Google Maps sub-module load errors appear under parallel load. Compare results with the unchanged build rather than reading failures in isolation.

## Functional and analytics regression checks (manual or e2e)

- Market switcher and `hhc_market` cookie; "Use my location" in the location switcher.
- Happy Hours: On Now, Day, Time (including overnight and All Day windows), Type, Top Rated, Near Me and the Sort options; URL sync and Back restore.
- Collection order matches the Control Panel preview; paused content stays hidden for granted venues.
- Saves (venue/event/guide).
- Tracking still fires with interception enabled (`E2E_INTERCEPT_TRACKING=1` in the Playwright e2e suite): discovery impressions/clicks, search events, venue/event views, GA4 events.
  With `E2E_INTERCEPT_TRACKING=1` the e2e fixture answers `/api/track/*` and every other request on `trackingBlockList.cjs` (Vercel Analytics/Speed Insights beacons, GA4 collection, Sentry) with a local 204, so a run against staging or Production sends nothing.
