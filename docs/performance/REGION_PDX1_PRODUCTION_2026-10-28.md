# pdx1 (Portland) Production move — 2026-10-28

Plan: [REGION_PDX1_PRODUCTION_PLAN.md](REGION_PDX1_PRODUCTION_PLAN.md). Evidence for the decision: [REGION_EXPERIMENT_2026-10-27.md](REGION_EXPERIMENT_2026-10-27.md).

## Release

- **Before:** `main` `b165217` (Weekly Picks consent change, cherry-picked onto `9aa07f4`), `dpl_HnBJSqxstCGeAgnAs6ndA9RGPGUs`, iad1. **Rollback target**, kept so the consent change is preserved.
- **Merge:** `origin/main` merged into `website` as `f6cab18`. Checked before pushing:
  - The cherry-picks are patch-identical to `8e121bc`/`34f2c8d`.
  - Excluding docs, the merged tree is identical to the reviewed staging commit `34f2c8d`.
  - The only non-doc difference from Production is `"regions": ["pdx1"]` in `operator-admin/vercel.json`.
- **Staging:** `dpl_5vTib78EYrCjBTUA3hTN48drqHRx` (`f6cab18`, `['pdx1']`). Smoke check passed, with every function response `pdx1::pdx1`.
- **Production:** `main` fast-forwarded `b165217` → `f6cab18` at 15:44 UTC. `dpl_9gswdy5EJid1A81zMVd3aV12rZpJ` Ready 15:46:41 UTC (08:46 Pacific), `['pdx1']`, aliased to happyhourcompass.com and www.

## Immediate checks (Production, 15:47–15:52 UTC)

- **Pages:** `/`, `/website-happy-hours`, `/central-okanagan/kelowna/train-station-pub` and `/api/health` all returned 200 with `x-vercel-id` `pdx1::pdx1`. The www domain returned 200.
- **Metadata:** titles, self-canonicals, Open Graph and JSON-LD match the pre-move baseline. There's no robots `noindex`, and `robots.txt` is unchanged.
- **Homepage:** hero, streaming placeholder, and 63 discovery placements/items, the same as before the move.
- **Signed out:** `/admin` → 307 `/login`; `/control-panel` and `/control-panel/claims` → 307 `/control-panel-login`.
- **Tracking:** in a headless browser, with every tracking request answered locally (nothing reached HHC or third parties):
  - the homepage sent 4 `/api/track/discovery` batches;
  - the venue page sent its `/api/track/venue-view`;
  - no tracking request got through unblocked.

## Scheduled jobs on pdx1

All runs listed are on `dpl_9gswdy5EJid1A81zMVd3aV12rZpJ`, so they ran in pdx1. "Idle" means the job ran successfully and found no work: **no email, Brevo call or Slack message was sent.**

| Time (UTC) | Job | Status | Duration | Work done |
|---|---|---|---|---|
| 15:50:41 | Brevo outbox | 200 | ≤1.1 s | Idle (claimed 0) |
| 16:00:14 | Email open tracking | 200 | 0.9 s | Idle (0 events) |
| 16:00:20 | Customer Success | 200 | 1.2 s | Idle (attempted 0, sent 0, errors 0) |
| 16:00:40 | Activation reminders | 200 | 2.2 s | Idle (1 skipped: operator already activated; errors 0) |
| 16:00:41 | Brevo outbox | 200 | — | Idle |
| 16:10–16:50 | Brevo outbox ×5, email open tracking ×3 | all 200 | — | Idle |
| 17:00:14 | Email open tracking | 200 | — | Idle |
| 17:00:20 | Customer Success | 200 | ≤1.6 s (max over both cycles) | Idle (attempted 0, sent 0, errors 0) |
| 17:00:40 | Activation reminders | 200 | ≤2.2 s | Idle (errors 0) |
| 17:00:41 | Brevo outbox | 200 | — | Idle |

**Whole deployment, 15:46–17:03 UTC:** 503 invocations (200 ×470, 204 ×31, 303 ×1, 404 ×1), with no 5xx. The longest cron run was 2.2 s, against the 60 s limit.

**What these runs prove:** the five jobs that run outside Mondays start, authenticate, reach the database and finish in pdx1, well within the limit. They **don't** prove sending, because every run was idle.

## Performance after the move (17:05–17:27 UTC)

**Data:** [`region-pdx1-production-2026-10-28/`](region-pdx1-production-2026-10-28/).

**Before:** the [Phase 2A Production run](PHASE2A_PRODUCTION_2026-10-27.md) on iad1, measured 2026-10-27 17:36–18:35 UTC. That's about the same time of day as this run, with the same code apart from the consent change.

**Conditions:** the documented ones (see [README](README.md)):
- From the Pacific Northwest.
- Lighthouse 13.5.0, Chrome 151, mobile, DevTools throttling, 3 cold + 3 warm runs per page.
- Journeys: 3 runs unthrottled and 3 on Fast 4G.
- Tracking blocked: both tracking audits reported no unblocked tracking requests.

### Hero arrival and full response, ms (`heroTiming.cjs`)

| | Runs, hero | Median hero / full |
|---|---|---|
| Domain, iad1 (2026-10-27) | 1055 970 910 986 967 1063 1128 1062 1123 1004 | 1030 / 2320 |
| Domain, pdx1 (today) | 807 735 763 773 733 636 662 805 708 761 | **748 / 1670** |

**Same-time comparison:** the iad1 rollback deployment `dpl_HnBJ…` and the pdx1 deployment `dpl_9gsw…`, measured alternately. The rollback deployment was warmed with 3 discarded requests first.

| Route | iad1 runs (full response) | pdx1 runs (full response) | Median iad1 → pdx1 |
|---|---|---|---|
| `/` hero | 1194 1320 1369 1001 1021 1112 1131 1107 1012 4100 | 744 608 629 582 593 632 906 596 650 785 | 1122 → **631** |
| `/` full | 2966 3104 2963 2471 2407 2529 2781 2611 2954 6059 | 1366 1611 1609 1394 1336 1461 1727 1376 1555 1476 | 2868 → **1469** |
| `/website-happy-hours` | 1491 1290 1314 1353 1103 | 715 550 584 634 574 | 1314 → **584** |
| Train Station Pub | 1007 891 1020 879 908 | 516 461 552 480 470 | 908 → **480** |

### Lighthouse, median of 3 (iad1 2026-10-27 → pdx1 today)

| Page | HTML complete | FCP | LCP | TBT | Score |
|---|---|---|---|---|---|
| Home, cold | 3.10 → 2.60 s | 2.65 → **2.35 s** | 2.65 → **2.35 s** | 293 → 379 ms | 87 → 86 |
| Home, warm | 3.03 → 2.16 s | 1.24 → **0.83 s** | 1.24 → **0.83 s** | 170 → 274 ms | 97 → 94 |
| Happy Hours, cold | 1.27 → 1.20 s | 2.70 → 2.63 s | 10.3 → 10.3 s | 493 → 768 ms | 50 → 44 |
| Happy Hours, warm | 1.45 → 0.98 s | 1.37 → 1.03 s | 2.75 → 2.50 s | 324 → 497 ms | 88 → 84 |
| Daily Specials, cold | 0.94 → 0.79 s | 1.96 → 2.12 s | 1.96 → 2.12 s | 265 → 290 ms | 92 → 91 |
| Daily Specials, warm | 0.90 → 0.71 s | 0.93 → 0.77 s | 0.98 → 0.77 s | 156 → 205 ms | 98 → 97 |
| Train Station Pub, cold | 1.77 → 0.73 s | 3.01 → 2.24 s | 16.3 → 15.3 s | 398 → 441 ms | 53 → 54 |
| Train Station Pub, warm | 0.99 → 0.66 s | 1.05 → 0.79 s | 1.14 → 0.83 s | 319 → 353 ms | 93 → 92 |
| Joey, cold | 1.15 → 0.74 s | 2.62 → 2.20 s | 6.56 → 6.19 s | 449 → 481 ms | 60 → 63 |
| Joey, warm | 0.86 → 0.64 s | 0.97 → 0.81 s | 0.97 → 0.81 s | 282 → 351 ms | 94 → 92 |

Per-run values are in `lighthouse-runs.csv`.

### Journeys, median of 3, ms (iad1 → pdx1; runs in `journeys.jsonl`)

| Journey | Unthrottled | Fast 4G |
|---|---|---|
| J1 Home → Happy Hours | 1181 → **838** (796 949 838) | 1673 → **1404** (1155 1474 1404) |
| J2 Happy Hours → venue | 891 → **714** (869 608 714) | 1226 → **905** (913 905 851) |
| J3 venue → Back | 93 → 100 | 421 → 388 |
| J4 On Now on / off | 97 / 229 → 83 / 210 | 234 / 734 → 259 / 785 |
| J5 Daily Specials → venue | 913 → **663** (805 663 608) | 1177 → **802** (924 802 784) |

### Server (Vercel metrics, `/` on happyhourcompass.com, p50)

| Deployment | Window | Renders | Duration | Time to first byte | CPU |
|---|---|---|---|---|---|
| iad1 `dpl_HnBJ…` | 10-27 22:00 → 10-28 15:44 UTC | 1377 | 2932 ms | 1299 ms | 731 ms |
| pdx1 `dpl_9gsw…` | 10-28 15:47 → 17:05 UTC | 123 | 2070 ms | 951 ms | 710 ms |

CPU is unchanged, as expected: the gain is time spent waiting on the database.

### Limitations

- **Small samples:** 3–10 runs per measure, from one location on one day. The baseline is from the previous day, at a similar time.
- **The same-time comparison uses the rollback deployment's own URL.** It had little traffic and one run was clearly cold (4100 / 6059 ms). The medians aren't sensitive to that run.
- **Blocking time (TBT) is higher on every page,** including pages where nothing changed (for example Happy Hours 493 → 768 ms). It measures browser CPU work, which the server region can't affect, so it most likely reflects load on the test machine.
- **Cold-load LCP on Happy Hours and Train Station Pub is dominated by images and maps** over a 1.6 Mbps throttled link, so it barely moves.
- **Lighthouse scores** move with TBT and aren't a good indicator here.
- **Server metrics:** the pdx1 window is short (78 minutes, 123 renders) and includes test traffic. Other routes' server metrics are dominated by cached and prefetch requests, so they're left out.
- **Real-user confirmation** needs about 28 days of Speed Insights.

## Remaining follow-ups (unverified on pdx1; no active monitoring)

Nothing is watching these automatically. Each is checked when the real event happens. Rollback steps are in the [plan](REGION_PDX1_PRODUCTION_PLAN.md#rollback-steps).

| Follow-up | When | Where to check | Escalate if |
|---|---|---|---|
| **Real email sending** (Resend: setup, reminder, milestone, password reset, signup) | Next real send (about 2 a day) | Resend → Emails; Control Panel email notes; Sentry | Failures, timeouts or "unconfirmed" outcomes |
| Resend open-tracking webhook | Next tracked email opened (about daily) | Resend → Webhooks; `#customer-success` | Repeated non-200 deliveries |
| **Brevo processing** (outbox with work, newsletter signup, Brevo webhook) | Next signup or consumer change (days apart) | Vercel logs `brevo-sync-outbox` (`claimed` > 0, `failed` 0); Brevo dashboard | Brevo timeouts or the outbox stuck |
| **Stripe webhooks** (and Checkout) | Next Stripe event (unpredictable) | Stripe → Developers → Webhooks | Non-2xx responses (Stripe retries for up to 3 days) |
| **Next Scout report** | Mon 2026-11-02 17:00 UTC (09:00 PST) | Control Panel → Analytics → Scout report; Vercel logs; `#ops-alerts` | Report missing after the 18:40 retry |
| Real form submissions | Next submission | Control Panel; Slack intake channels | Errors or missing notifications |
| **Real-user performance** | About 2026-11-25 (28 days) | Vercel Speed Insights, mobile p75 LCP/FCP, against the 28 days before 2026-10-28 | No improvement, or a regression |

## Pre-existing log errors (not caused by the move)

`[getCollectionById] TypeError: fetch failed` and `[getSavedGuideCardsByIds] TypeError: fetch failed` are logged at error level.
- The previous iad1 deployment logged about 50 between 07:44 and 15:43 UTC today, mostly on `/` at :xx:27 on a 5-minute cadence (probably an uptime check), plus a few on guide, venue, `/business` and `/about` pages.
- pdx1 logged 2 in its first 13 minutes, the same or a lower rate.
- Pages still returned 200; homepage section isolation handled the failures.
- Not investigated further here. Worth a separate look.

Two other error-level entries in the first hour on pdx1 were also logged by the iad1 deployment earlier the same day:
- `/sitemap.xml` returned 200 but logged `[getMerchandisedPublicGuides:guides_library] Could not find a relationship between 'content_guide_placements' and 'content_guides' in the schema cache` (5+ times on iad1).
- `/venue/submission-<uuid>` returned 404 after an `invalid input syntax for type uuid` error from the consumer-app venue route (also seen on iad1).

## Customer Success 56.4 s run: reconciliation

- **Yesterday's report (2026-10-27):** 30-day max 56.4 s, from a window starting about 2026-09-27 18:00 UTC.
- **Today's preflight:** the 30-day window starts 2026-09-28 15:42 UTC, with max 26.2 s (2026-10-02); the 7-day max is 16.4 s.
- **Conclusion:** both figures are consistent. The 56.4 s run happened between about 2026-09-27 18:00 and 2026-09-28 15:40 UTC, and has since aged out.
- **Uncertainty:**
  - Vercel's metrics only go back 30 days (a query for 20–30 September returned nothing), so the run can't be re-examined.
  - Its cause and exact time are unknown, and so is whether it came close to the 60 s timeout because of a one-off (for example a backlog or a slow external call).
  - No job code or limits were changed. If it recurs, the hourly duration check should catch it, and the 60 s limit is the risk to watch.
