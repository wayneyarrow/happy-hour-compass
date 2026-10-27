# Phase 1 results — Production, 2026-10-27

The location-prompt and image-loading change (Phase 1), measured on Production after release and compared with the [2026-10-26 baseline](BASELINE_2026-10-26.md). Per-run data: [`phase1-production-2026-10-27/`](phase1-production-2026-10-27/) (`lighthouse-runs.csv`, `journeys.jsonl`, `location-checks.jsonl`). Method: [`README.md`](README.md).

- **Release:** `main` fast-forwarded `1380628` → `5592a2e` (`67fc9fa` location + images, `5592a2e` Near Me fix, plus two docs commits). Production deployment `dpl_CKdihyj4MtDypCJhF4byaJifhZCW`, ready 2026-10-27 03:53 UTC, region iad1.
- **Rollback point:** `main` `1380628`, deployment `dpl_DiP2uTFwQyb4q6jAbGPSd2VACmXg` (the baseline deployment).
- **Measured:** 2026-10-27 04:00–04:30 UTC (about 9:00–9:30 PM Kelowna), Lighthouse 13.5.0, Chrome 151, mobile, DevTools throttling, 3 runs per scenario, medians.
- **Tracking:** every run reported no unblocked tracking requests (corrected block list).
- **Difference from the baseline:** the baseline ran mid-afternoon (3–4 PM Kelowna). Page-load figures are unaffected; the On Now filter has more matching venues in the evening.

## Page loads (cold, median of 3)

| Page | Transfer (images), baseline → now | Image requests | HTML complete | FCP | LCP | Score |
|---|---|---|---|---|---|---|
| Home | 10.4 MB (9.9) → 1.5 MB (0.9) | 46 → 5 | 2.89 → 2.72 s | 4.62 → 3.99 s | 4.62 → 3.99 s | 64 → 72 |
| Happy Hours | 11.3 MB (10.7) → 1.9 MB (0.9) | 66 → 11 | 1.50 → 1.29 s | 2.48 → 2.39 s | 49.2 → 10.4 s | n/a → 52 |
| Daily Specials | 631 → 630 KB | 1 | 0.92 → 0.89 s | 2.14 → 2.10 s | 2.14 → 2.10 s | 91 → 92 |
| Train Station Pub | 2.9 MB, unchanged | 17 | 1.02 → 0.85 s | 2.10 → 2.19 s | 15.5 → 15.4 s | 53 → 54 |
| Joey | 1.4 MB, unchanged | 10 | 0.85 → 0.97 s | 2.32 → 2.53 s | 6.28 → 6.38 s | 63 → 63 |

Warm loads: Happy Hours LCP 3.00 → 2.66 s; Home LCP 2.86 → 2.95 s (warm Home is bound by the server's HTML time, which Phase 1 did not change).

## Journeys (median of 3)

| Journey | Unthrottled, baseline → now | Fast 4G, baseline → now |
|---|---|---|
| J1 Home → Happy Hours | 1.35 → 1.03 s | 1.91 → 1.51 s |
| J2 Happy Hours → venue | 0.87 → 0.79 s | see per-run data |
| J5 Daily Specials → venue | 0.95 → 0.72 s | see per-run data |
| J4 On Now on / off | — | 0.27 / 0.47 → 0.57 / 0.65 s |

**The J4 difference is not a Phase 1 regression.**
- **Same host, no map:** old (`1380628`) and new (`5592a2e`) deployments, both tested on their `*.vercel.app` URLs, measured the same (on 339 vs 305 ms, off 321 vs 322 ms).
- **What causes it:** Google Maps redraws its markers when the filter changes. The Maps key only allows happyhourcompass.com, so the map, and that cost, only appear on the real domains.
- **Timing:** the baseline ran when fewer venues were On Now.

## Location and analytics checks (Production)

- **No automatic prompt:** no page requested location on load in any permission scenario (undecided, granted, denied, unavailable, no Permissions API, unsupported).
- **Near Me and Nearest First:**
  - Near Me only applies, and only then is counted as applied, once a position exists.
  - Each failure shows its own message.
  - The sort chip reads "Sort" until a position exists.
- **GA4** (captured in the browser and blocked; nothing was sent): `discovery_filtered` is pushed once, with `filter_count: 1`, when location is granted, and not at all when it's denied. GA reports and DebugView were not checked.
- **Website search event:** `otherFiltersActive` reflects whether Near Me actually applied.

## Not verified

- **Not tested:** Safari on iPhone, Instagram's in-app browser, and denied location on a physical device. Pixel and Chromebook were tested by hand and passed.
- **Real-user comparison:** Speed Insights needs about 28 days of post-release traffic.
