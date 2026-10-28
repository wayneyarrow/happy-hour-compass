# Phase 3: Focused image delivery

Status: **on staging for review, not in Production** (2026-10-28). Staging results: see "Staging" below.

Data: [`phase3-image-delivery-2026-10-28/`](phase3-image-delivery-2026-10-28/).

## Scope

Images are now served through `next/image` (Vercel Image Optimization): resized to the displayed width and converted to WebP.

**Changed:**
- Happy Hours result cards (`SearchResultCard`). Guide pages reuse this card for their venue grid, so it changes there too.
- The venue page main photo, on phone and desktop.
- The desktop gallery side tiles.
- The phone thumbnail strip.
- The small related-guide thumbnails on venue pages.

**Unchanged:**
- The full-screen viewer and the all-photos overlay, which still use full-size originals.
- Homepage images, Maps, uploads and storage.
- Every other card and image component.

| File | Change |
|---|---|
| `operator-admin/src/lib/imageDelivery.ts` (new) | The allowlist (exact Supabase host and the public `venue-images` bucket path; local `/images/`), `isOptimizableImageSrc()`, and `PHOTO_QUALITY = 70` |
| `operator-admin/next.config.ts` | `images.remotePatterns`: exact host, bucket path, no query string. `images.qualities: [70, 75]` (75 is the default the existing logo images use) |
| `website-happy-hours/SearchResultCard.tsx` | `next/image` `fill`. Adds a `sizes` prop, defaulting to the Happy Hours layout. Loading, priority and the broken-image handler are unchanged |
| `[market]/guides/[slug]/GuideDetailView.tsx` | Passes the guide grid's `sizes` value |
| `[market]/[city]/[slug]/VenueGallery.tsx` | Main photo (phone and desktop share one `sizes` value), side tiles and thumbnail strip |
| `[market]/[city]/[slug]/page.tsx` | Related-guide thumbnails (56 px) |
| `tests/unit/lib/imageDelivery.test.ts` (new) | Allowlist behaviour, and that the config matches it |

**Fallback for unexpected sources:** anything outside the allowlist (another host or bucket, a query string, a `data:` URL) is rendered `unoptimized`, as the original URL, rather than breaking.

## Baseline (Production, 2026-10-28 17:07–17:24 UTC, pdx1)

Lighthouse 13.5.0, mobile, DevTools throttling (1.6 Mbps), 3 cold and 3 warm runs. Per-run data: `baseline-production-images.csv`.

| Page | LCP cold (runs) | Median | LCP element | Photo requests / KB | Maps requests / KB |
|---|---|---|---|---|---|
| Happy Hours | 10318, 10282, 10084 | 10.28 s | Maps static image | 4 / 743 | 6 / 171 |
| Train Station Pub | 15331, 15332, 9261 | 15.33 s | Main photo | 6 / 1,756 | 10 / 162 |
| Joey | 6190, 6379, 6153 | 6.19 s | Main photo (placeholder) | 1 / 343 | 8 / 144 |

**Where the time goes:**
- **Happy Hours:** the LCP request starts late. Load delay is 9.2 s, while the download takes 0.94 s. That delay is Maps JavaScript loading after the page scripts, which share bandwidth with the card photos.
- **Train Station Pub:** the main photo's download takes 14.6 s, because it competes with 3 full-size thumbnails (893 KB) and 2 guide thumbnails (486 KB).
- **Joey:** the photo's own 5.4 s download.

**Warm loads** are 0.8–2.5 s; images come from the browser cache.

**Delivered versus displayed** (`baseline-production-dimensions.txt`): every photo was the 1600-px original (uploads are capped at 1600 px, JPEG quality 0.8).
- Cards: shown at 378×200 on a phone and 307×200 on desktop, but received 97 KB–1 MB each.
- Gallery thumbnails: shown at 52×38 on a phone and 234×236 on desktop, but received 258–337 KB each.
- Guide thumbnails: shown at 56×56, but received 204–282 KB each.
- The hidden copies on phone and desktop share URLs, so nothing downloaded twice.

## Quality

The comparison is against the original resized to the same width, on 10 real photos (`quality-comparison.csv`).

| Width | q60 | q70 | q75 | q80 |
|---|---|---|---|---|
| 384 px: median SSIM / size | 0.966 / 16 KB | 0.972 / 18 KB | 0.974 / 19 KB | 0.981 / 22 KB |
| 750 px: median SSIM / size | 0.958 / 46 KB | 0.965 / 52 KB | 0.968 / 56 KB | 0.976 / 67 KB |

In 2× zoomed side-by-sides, q60 visibly smoothed fine texture on the worst-case photo; q70 and q75 couldn't be told apart from the original. So **q70** is used.

## Local before and after

Both builds were run locally with `next start`, against the shared database and real Supabase images:
- **Before:** `4e425a1`, on :3101.
- **After:** the working tree, on :3100.

These figures are comparable with each other, not with Production. The Maps API key rejects localhost, so Maps tiles don't load locally; the static map still does.

### Lighthouse, mobile cold, 3 runs each

| Page | Before LCP (runs) | After LCP (runs) | Median | Photo requests / KB | LCP download time |
|---|---|---|---|---|---|
| Train Station Pub | 14142, 16977, 14150 | 2335, 2299, 2290 | **14.15 → 2.30 s** | 6 / 1,756 → 7 / 70 | 13.5 → 1.6 s |
| Joey | 5075, 5030, 5045 | 3379, 2529, 2558 | **5.05 → 2.56 s** | 1 / 343 → 1 / 76 | 4.4 → 1.9 s |
| Happy Hours | 9476, 8925, 8859 | 7578, 7576, 7531 | **8.93 → 7.58 s** | 4 / 743 → 4 / 160 | LCP is still the Maps image; load delay 7.3 → 6.0 s |

Warm medians: Train Station Pub 0.78 → 0.71 s, Joey 0.79 → 0.74 s, Happy Hours 2.13 → 1.99 s.

The extra request on Train Station Pub is its first photo's own 96-px thumbnail, about 1.3 KB. Previously it reused the main image URL.

**Maps on Happy Hours:** the LCP element is the Maps static image both before and after. Smaller photos let it start about 1.3 s sooner, but the remaining delay is Maps JavaScript loading. Production also loads about 171 KB of Maps imagery that doesn't load locally. Maps is out of scope for this phase.

### Image bytes per page view (`image-requests-local.jsonl`)

| Page | Phone | Desktop | Retina desktop |
|---|---|---|---|
| Happy Hours | 742 → 159 KB | 2,708 → 167 KB | — |
| Train Station Pub | 1,753 → 69 KB | 1,753 → 85 KB | 1,753 → 384 KB |
| Joey | 344 → 77 KB | 344 → 162 KB | 344 → 241 KB |

Every photo is now `image/webp`.

### Delivered widths (`delivered-widths-and-fallback-local.txt`)

Each image now gets the smallest standard width at or above its displayed width × device pixel ratio:

| Image | Phone (1.75×) | Desktop (1×) | Retina (2×) |
|---|---|---|---|
| Card | 750 | 384 | 750 |
| Venue main photo | 750 | 750 | 1920 requested; the 1600-px original is served, never upscaled |
| Joey main photo (no side tiles) | 750 | 1200 | 3840 requested; 1600 served |
| Gallery thumbnail / side tile | 96 | 256 | 640 |
| Related-guide thumbnail | 128 | 64 | 128 |
| Guide-page venue card | 640 | 384 | 640 |

**Duplicates:** none. The hidden desktop main photo on phones (and the reverse) picks the same URL as the visible one.

## Behaviour checks (after)

- **Screenshots:** phone (390×844 at 2×) and desktop (1440×900) of Happy Hours, Train Station Pub and Joey look the same as before.
  - Layout, crop and page height are identical.
  - Mean pixel difference is 0.5–2.6 out of 255, only inside photos (re-encoding).
  - See `screens-*-tsp-before-after.jpg`.
- **CLS:** unchanged (0 on phone, 0.002–0.005 on desktop).
- **Loading:**
  - Every first-screen image loads.
  - Lazy images stay deferred, and eager/high priority is unchanged.
  - No preload links were added; `priority` isn't used.
- **Gallery interactions:** all work.
  - A thumbnail tap switches the phone main photo.
  - The desktop hover zoom (scale 1.05) still applies.
  - The full-screen viewer opens and closes with Escape, and still loads the 1600-px original.
  - The all-photos overlay still loads originals.
- **Broken images** (every request for one photo answered with a 404):
  - **Before:** the card, main photo and Joey photo showed the browser's broken-image icon. The `onError` handler never ran, because the image failed before React attached it.
  - **After:** the failed image is hidden and the grey background shows, which was always the intent.
  - The phone thumbnail strip had no handler before and still has none (unchanged).
- **Requests the resizer refuses:** a quality other than 70/75, another host, another bucket, or a non-standard width all return `400`.
- **Tests:** 3,132 unit tests pass, including the new `imageDelivery.test.ts`; `tsc` and ESLint are clean on the changed files.

### First resize versus cached (local `next start`, cold image cache)

| Request | First (MISS) | Then (HIT) |
|---|---|---|
| Train Station Pub main photo, 750 px (Supabase source, 373 KB) | 0.50 s | 5–6 ms |
| Same, 96 px | 0.08 s | 7–9 ms |
| Joey placeholder, 750 px | 0.08 s | 4–9 ms |
| Same, 96 px | 0.04 s | 8 ms |

Responses carry `Content-Type: image/webp` and `Cache-Control: public, max-age=31536000, must-revalidate`.

On Vercel the first request for each variant is resized once and then served from the CDN. Vercel's own timing still needs measuring on staging.

## Costs

**These are estimates.** Pricing was confirmed 2026-10-28 from Vercel's [limits and pricing page](https://vercel.com/docs/image-optimization/limits-and-pricing):
- Transformations: $0.05–0.0812 per 1K, billed on each cache MISS or STALE.
- Cache writes: $4.00–6.40 per 1M 8 KB units.
- Cache reads: $0.40–0.64 per 1M units, only on reads from the global cache.

**How long resized images stay cached:**
- Remote: the larger of the source's `max-age` (one year for Supabase) and `minimumCacheTTL`.
- Local: up to 31 days.

**Expected usage:**
- About 250 source images × about 6 widths ≈ 1,500 variants in the first month. After that, mostly placeholders re-resizing monthly.
- At about 5.7k page views a month (30-day Web Analytics), that comes to roughly **$0.20–0.50/month**. That's within the Pro plan's $20 monthly credit; current function usage is about $1.60/month.

**Worst case:** someone requesting every allowed variant of every object in the bucket. The allowed variants per object are bounded (16 widths × 2 qualities × format), so 1,000 objects would cost about $5. Vercel's spend notifications are on.

## Remaining risks

- **First-resize latency.** The first visitor to each new variant waits for the resize: up to about 1 s for a large Supabase photo on staging (Vercel p95 1.17 s). After that it's a CDN hit.
- **Retina desktop** loads 1600-px WebP originals for large slots (about 150–200 KB). That's still smaller than before, but larger than phone views.
- **Map popups (`SearchResultsMap`) still use the original image URL.** The browser can't reuse the card's resized copy, so opening a popup downloads the original. That was also true before, and map popups are out of scope.
- **The guide-page venue grid** uses a fixed `sizes` value. If that layout changes, the value needs updating.

## Rollback

- Revert the commit.
- Or, in Vercel, instantly roll back to the previous deployment.
- As an emergency switch, `images.unoptimized: true` serves originals everywhere.

None of these touch data or storage.

## Staging (2026-10-28)

- **Deployed:** `website` `b955127`, `dpl_25uR8kjYVwqixxSRnC6dEJ2RMcCE`, Ready 18:50 UTC, `['pdx1']`, staging.happyhourcompass.com.
  - This push also carried the docs-only commits `091bda5`, `1581491` and `4e425a1`.
  - `vercel.json` is unchanged (`"regions": ["pdx1"]`).
- **Before:** the previous staging deployment (`f6cab18`, the same app as Production), measured 18:36–18:48 UTC just before the push.
- **After:** measured 18:50–19:16 UTC.
- **Conditions:** the documented ones (Lighthouse 13.5.0, mobile, DevTools throttling), with tracking blocked; every audit reported nothing got through.

### Lighthouse, mobile, 3 runs

Data: `staging-before-images.csv`, `staging-after-images.csv`.

| Page | Load | Before LCP (runs) | After LCP (runs) | Median | Photo requests / KB |
|---|---|---|---|---|---|
| Train Station Pub | cold | 14291, 14331, 14494 | 3206, 3293, 3214 | **14.33 → 3.21 s** | 6 / 1,756 → 7 / 68 |
| Joey | cold | 5243, 5353, 5405 | 3427, 3453, 3352 | **5.35 → 3.43 s** | 1 / 343 → 1 / 76 |
| Happy Hours | cold | 11177, 9413, 9377 | 8022, 7581, 7548 | **9.41 → 7.58 s** | 4 / 743 → 4 / 160 |
| Train Station Pub | warm | 842, 818, 768 | 768, 719, 704 | 0.82 → 0.72 s | |
| Joey | warm | 792, 774, 798 | 835, 924, 740 | 0.79 → 0.84 s | |
| Happy Hours | warm | 2079, 2089, 1946 | 2408, 2158, 1982 | 2.08 → 2.16 s | |

- **Maps is unchanged:** 6–10 requests and 129–179 KB per page. It's still Happy Hours' LCP element, and its load delay is 6.5 s after (median).
- **Venue pages:** LCP is now mostly the main photo's own download, about 2.5 s on the throttled link (it was 14 s on Train Station Pub).
- **Warm loads** are within normal run-to-run variation, since images come from the browser cache.

### First resize versus cached (Vercel, staging)

Image sizes nobody had requested yet, timed from the Pacific Northwest (time to first byte):

| Request | MISS | HIT (2 repeats) |
|---|---|---|
| Train Station Pub main photo, 750 px (Supabase source, 373 KB) | 1.04 s | 0.28, 0.26 s |
| Same, 96 px | 0.44 s | 0.15, 0.14 s |
| Joey placeholder, 750 px | 0.62 s | 0.31, 0.14 s |
| Same, 96 px | 0.27 s | 0.20, 0.16 s |

- **Headers:** `content-type: image/webp`, `x-vercel-cache: MISS` then `HIT`, and `age` increasing. Cache-control is a one-year `must-revalidate` for Supabase sources and a one-year `immutable` for placeholders.
- **Vercel metrics since the deploy (all test traffic):** 242 transformations. Source 55.4 MB → output 6.3 MB (−89%). Resize duration p50 176 ms, p95 1.17 s, max 1.68 s.
- **"Cold" in Lighthouse** means a cold browser cache. The CDN copies were already warm from the checks above. The first visitor to an uncached variant adds the MISS cost in the table.

### Checks on staging

- **Delivered widths, bytes, duplicates and fallback** match the local results.
  - Data: `image-requests-staging.jsonl`, `delivered-widths-and-fallback-staging.txt`.
  - Phone photo bytes: Happy Hours 159 KB, Train Station Pub 68 KB, Joey 77 KB.
  - All photos are WebP, with no duplicate downloads from the hidden copies.
  - The broken-image fallback hides the image; the phone thumbnail strip is unchanged.
- **Refused requests** all return 400: a quality other than 70/75, another host, another bucket, a query string, a non-standard width.
- **Non-allowlisted sources** render as the original URL with no `srcset`.
- **Interactions:** a thumbnail tap switches the main photo; hover zoom is 1.05; the full-screen viewer (1600-px original) opens and closes with Escape; the all-photos overlay loads originals.
- **Screenshots** (phone 2×, desktop 1×), staging against Production as the "before" reference:
  - Same page sizes and the same first-screen image loading.
  - CLS 0 / 0.002–0.005.
  - Mean pixel difference 0.85–2.63, only inside photos.
  - High-density crops at 2× desktop and 3× phone: `screens-hidpi-tsp-production-vs-staging.jpg`. Same framing and sharpness.
- **Guide page** (`/central-okanagan/guides/date-night-happy-hours-in-kelowna`): the venue cards get 640 px on a phone, 384 on desktop and 640 on retina. Discovery tracking fired (2 batches, intercepted).
- **Tracking:** the homepage fired 4 discovery batches and Train Station Pub its venue view. Everything was answered locally; nothing got through.

### Journeys, median of 3, ms

Data: `journeys-staging-*.jsonl`, `journeys-production-reference.jsonl`.

| Journey | Unthrottled before → after | Fast 4G before → after | Fast 4G rerun, staging vs Production, 19:13–19:15 |
|---|---|---|---|
| J1 Home → Happy Hours | 988 → 810 | 1318 → 1671 | 1328 vs 1288 |
| J2 Happy Hours → venue | 641 → 621 | 923 → 1446 | 1314 vs 1059 |
| J3 venue → Back | 125 → 131 | 349 → 448 | 487 vs 432 |
| J4 On Now on / off | 116 / 211 → 80 / 236 | 231 / 706 → 198 / 794 | 220 / 877 vs 239 / 834 |
| J5 Daily Specials → venue | 732 → 586 | 764 → 1073 | 803 vs 864 |

**The slower Fast 4G runs** spent their extra time before the URL changed, waiting for the venue page's navigation data from the server (976–1,714 ms against 405–472 ms before). The photo change doesn't affect that.
- **Timing:** they fell at 19:00:12–19:01:00, when Production's hourly jobs run against the shared database.
- **The rerun:** in the rerun away from the hour, J1 and J5 match Production. One J2 run still took 3.9 s, again before the URL changed.
- **Why Production was faster:** it used prefetched navigation data, while staging fetched it on click (low-traffic staging instances).
- **Status:** inconclusive, not attributable to images. Recheck after any Production promotion.

### Cost (estimate)

- **Testing so far:** 242 transformations, about $0.01–0.02.
- **The projection above still holds:** about 1,500–3,000 variants per cache cycle (about $0.08–0.25), plus cache writes (average output about 26 KB, roughly $0.05). That's about **$0.20–0.50/month**.
- **Shared cache:** the resized images cached during staging testing are reused by Production, because the cache key is per project.

### Comparison limitations

- 3 runs per measure, from one location.
- The "before" staging deployment had been idle, and the "after" deployment was new; both are low-traffic.
- Production served as the visual and journey reference, so it's same-time but a different hostname and traffic level.
- Real-user effect needs Speed Insights after any Production release.

## Next validation (after approval)

1. **Wayne's visual review on staging:**
   - phone, desktop and high-density;
   - cards, gallery, thumbnails, full-screen and all-photos views;
   - a guide page.
2. **Production, if promoted:**
   - the same checks;
   - Fast 4G journeys rechecked;
   - 7 days of transformation counts and cost;
   - then Speed Insights.
