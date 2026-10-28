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

## Not yet verified (needs real events)

- Any email sent by Resend from pdx1.
- A Resend open-tracking webhook.
- A Brevo API call (outbox with work, or a newsletter signup).
- Any Brevo webhook.
- A Stripe webhook or Checkout.
- A real form submission.
- The Scout report: Monday 2026-11-02 17:00 UTC.
- Real-user speed (Speed Insights, about 28 days).

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
