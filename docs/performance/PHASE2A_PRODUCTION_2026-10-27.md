# Phase 2A results — Production, 2026-10-27

Homepage hero streaming plus the browse-links fallback, measured on Production after release. The comparison is with the [Phase 1 Production results](PHASE1_PRODUCTION_2026-10-27.md) and the [2026-10-26 baseline](BASELINE_2026-10-26.md). Change details: [PHASE2A_HOMEPAGE_STREAMING.md](PHASE2A_HOMEPAGE_STREAMING.md). Data: [`phase2a-production-2026-10-27/`](phase2a-production-2026-10-27/).

- **Release:** `main` fast-forwarded `5592a2e` → `9aa07f4` (`5a70816`, `a182778`, `e11158d`, plus docs-only `9aa07f4`). Production deployment `dpl_94x4iTNnCuCMZjZcEBcs3p1MNPtB`, ready 2026-10-27 17:39 UTC, iad1.
- **Rollback point:** `main` `5592a2e`, deployment `dpl_CKdihyj4MtDypCJhF4byaJifhZCW`.
- **Measured:** 17:36–18:35 UTC (about 10:30–11:35 AM Kelowna), from the Pacific Northwest.
  - Lighthouse 13.5.0, Chrome 151, mobile, DevTools throttling.
  - Tracking blocked in every run; every audit reported none unblocked.

## Hero arrival on happyhourcompass.com (`heroTiming.cjs`, 10 runs, ms)

| | Hero, per run | Median | Full document, median |
|---|---|---|---|
| Before promotion (`5592a2e`) | 2706 3122 2761 2471 2373 2271 2321 2895 2557 2318 | 2514 | 2574 |
| After promotion (`9aa07f4`) | 1055 970 910 986 967 1063 1128 1062 1123 1004 | **1030** | 2320 |

The two deployment URLs were also measured alternately (`hero-deployments.jsonl`): old median 3064 / 3083 ms, new 1163 / 2560 ms. The old deployment had almost no traffic after promotion and looked cold, so the same-domain pair above is the fairer comparison.

## Lighthouse, cold loads (median of 3)

| Page | 10-26 baseline FCP / LCP | Phase 1 FCP / LCP | Now FCP / LCP | CLS now | Score Phase 1 → now |
|---|---|---|---|---|---|
| Home | 4.62 / 4.62 s | 3.99 / 3.99 s | **2.65 / 2.65 s** | 0 | 72 → 87 |
| Happy Hours | 2.48 / 49.2 s | 2.39 / 10.4 s | 2.70 / 10.3 s | 0.001 | 52 → 50 |
| Daily Specials | 2.14 / 2.14 s | 2.10 / 2.10 s | 1.96 / 1.96 s | 0 | 92 → 92 |
| Train Station Pub | 2.10 / 15.5 s | 2.19 / 15.4 s | 3.01 / 16.3 s | 0.007 | 54 → 53 |
| Joey | 2.32 / 6.28 s | 2.53 / 6.38 s | 2.62 / 6.56 s | 0.011 | 63 → 60 |

- **Warm homepage LCP:** 2.95 s (Phase 1) → **1.24 s**, score 89 → 97.
- **Other pages:** their code didn't change; differences are run-to-run and time-of-day variation. The Train Station Pub cold runs ranged 2.5–3.8 s for FCP.
- **Homepage HTML complete** is 3.1 s under throttling (Phase 1: 2.72 s). With streaming, the browser downloads assets alongside the document, so this no longer marks when the page appears.

## Journeys (median of 3)

| Journey | Phase 1 unthrottled → now | Phase 1 Fast 4G → now |
|---|---|---|
| J1 Home → Happy Hours | 1.03 → 1.18 s | 1.51 → 1.67 s |
| J2 Happy Hours → venue | 0.79 → 0.89 s | 1.02 → 1.23 s |
| J5 Daily Specials → venue | 0.72 → 0.91 s | 0.92 → 1.18 s |
| J4 On Now on / off | 0.17 / 0.20 → 0.10 / 0.23 s | 0.57 / 0.65 → 0.23 / 0.73 s |

J2 and J5 involve no changed code and slowed by a similar amount to J1. Phase 1 ran at about 9 PM local and this run at about 11:30 AM, so time of day is the likeliest cause, though these runs can't prove it.

## Server (Vercel metrics, `/` on happyhourcompass.com)

| | Renders | Duration p50 | CPU p50 | Time to first byte p50 |
|---|---|---|---|---|
| Previous deployment, last 24 h | 1141 | 2955 ms | 845 ms | 2914 ms |
| New deployment, first ~2 h (mostly test traffic) | 97 | 2521 ms | 530 ms | 935 ms |

The new sample is small and test-heavy, so these figures are indicative only.

## Functional checks (Production)

- **Finished homepage:** identical to the previous deployment on mobile and desktop. Sections and Collection order, both Weekly Picks placements, metadata, JSON-LD and discovery payloads all match, CLS 0, and comped venues appear in the same places.
- **Links:** all 60 checkable homepage links return 200.
- **Market switching** works.
- **Fallbacks:** JavaScript off, scripts not running (with and without reduced motion), and an interrupted response (read-only relay) all show the browse links. They're reachable by keyboard.
- **Crawlers:** Googlebot and Facebook user agents get complete HTML, and their metadata matches a visitor's apart from Sentry's trace IDs. Every response is `private, no-store`, `MISS`.
- **Test traffic:** no Vercel Analytics page views came from test browsers; the 5 recorded since promotion were Mac visitors. My tests did cause homepage renders, visible in Vercel's request logs.

## Not verified

- Search Console's live test and Facebook's Sharing Debugger (no access from the test session).
- Real-user Speed Insights (needs about 28 days).
- The shared rendering failure on a deployed build (local only).
- Instagram's brief white screen on open.
