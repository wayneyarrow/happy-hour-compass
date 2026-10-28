# pdx1 (Portland) Production move: decision and monitoring plan

Status: **proposed, not promoted.** Evidence: [REGION_EXPERIMENT_2026-10-27.md](REGION_EXPERIMENT_2026-10-27.md).

- **Staging** runs pdx1: first `d8a4f5d` (`dpl_4buej6LkQ3ZFfZZFHAmzdB6kNu8t`), now `34f2c8d` (`dpl_7HDgCyWEcYrow4Qk8Z2zjcBCetys`). Wayne's signed-in Operator Admin and Control Panel checks passed there.
- **Production** (preflight, 2026-10-28) is `main` `b165217`, `dpl_HnBJSqxstCGeAgnAs6ndA9RGPGUs`, iad1. This is the Weekly Picks consent change cherry-picked onto `9aa07f4`. It is the **rollback point**. Don't roll back to `dpl_94x4iTNnCuCMZjZcEBcs3p1MNPtB`: that would also undo the consent change.
- **Database region:** confirmed by Wayne in Supabase as West US (Northern California), us-west-1.

## Decision summary

- **Expected gain:** server time on the homepage, Happy Hours and venue pages roughly halves. Hero arrival is about 0.5 s sooner and the full homepage about 1.3 s sooner. These are staging measurements; real-user confirmation comes from Speed Insights later.
- **Cost:** about the same. pdx1 is priced the same as iad1.
- **Database region:** confirmed us-west-1 (see above).
- **What needs a real event:** scheduled jobs, webhooks and email can only be confirmed on Production with real events. The plan below covers how to watch them.

## Integrations: what to watch

Volumes are Production, last 30 days (Vercel metrics). Times are UTC.

| Integration | Still untested in Portland | Next normal opportunity | Where to check | Expected | Rollback or investigate if |
|---|---|---|---|---|---|
| **Customer Success deliveries** (cron, hourly at :00; sends milestone emails via Resend) | A real run: database work plus Resend sends from pdx1 | The first :00 after promotion | Vercel → Logs (route `/api/cron/customer-success-deliveries`), Vercel → Cron Jobs, Sentry, Slack `#ops-alerts` | 200 within seconds (30-day p95 6.0 s, max 56.4 s against the 60 s limit, measured 2026-10-27. At preflight (2026-10-28): 7-day p50 1.9 s / p95 4.0 s / max 16.4 s; 30-day max 26.2 s; all 200) | **Rollback:** any timeout or 5xx, or failures repeating over 2 runs. **Investigate:** p95 clearly above about 6 s. |
| **Operator activation reminders** (cron, hourly at :00; reminder and expiry emails, Slack) | A real run | The first :00 | Same, plus Control Panel claim/submission Internal Notes when a reminder is due | 200 (p95 6.1 s, max 40.6 s) | **Rollback:** timeout, 5xx, or a `critical` Slack alert about an unacknowledged reminder. |
| **Email open tracking** (cron, every 15 min) | A real run | Within 15 min | Vercel Logs and Cron Jobs | 200 (p95 1.8 s) | **Rollback:** repeated 5xx. |
| **Brevo outbox sync** (cron, every 10 min; calls Brevo only when the outbox has items, about 5 Brevo calls a month) | A run that actually calls Brevo from pdx1 (Brevo is EU-hosted) | Runs within 10 min; a Brevo call only when a newsletter signup or consumer change queues one (days apart) | Vercel Logs; Brevo → contacts and transactional logs; Slack `#ops-alerts` | 200 (p95 1.9 s, max 19 s). Brevo requests time out at 10 s | **Investigate:** Brevo timeouts. **Rollback:** repeated failures leaving the outbox stuck. |
| **Scout report** (cron, Mondays 17:00, retried to 18:40) | A real weekly run (writes `scout_reports`) | **Monday 2026-11-02, 17:00 UTC** (9 AM Pacific after the DST change) | Control Panel → Analytics → Scout report; Vercel Logs; `#ops-alerts` | The report row exists after 17:00; a run takes up to about 27 s | **Investigate:** missing report or retries exhausted. **Rollback:** only if it's clearly the region (for example timeouts). |
| **Resend sends** (setup, reminder, milestone, password reset, signup confirmations; about 53 a month) | Real sends from pdx1 | Whenever a flow sends: crons hourly, or user actions (about 2 a day) | Resend dashboard → Emails; Control Panel email registry and Internal Notes; Sentry | Accepted by Resend. The code's own bounds are a 20 s send start and the 6-minute claim | **Rollback:** sends failing, timing out, or more "unconfirmed" outcomes. |
| **Resend open webhook** (about 30 a month) | A real signed event processed in pdx1 | About daily; whenever a tracked milestone email is opened | Resend → Webhooks (delivery status); Slack `#customer-success`; Control Panel Internal Notes ("Email opened") | 200 (p95 2.7 s) | **Rollback:** repeated non-200 deliveries. Resend retries, so a single failure isn't conclusive. |
| **Stripe webhook** (3 a month; no paying subscriptions) | A real signed event processed in pdx1 | Unpredictable; possibly weeks | Stripe Dashboard → Developers → Webhooks (attempts and response codes); Slack plan-change and `#ops-alerts` | 200 (about 1 s) | **Rollback:** non-2xx responses (Stripe retries for up to 3 days, so act within that). |
| **Brevo webhook** (0 in 30 days) | Any delivery | Unknown | Brevo → webhook logs; Vercel Logs | — | Investigate if a delivery fails. |

## Can't be confirmed without a real event

1. A real cron run of each of the 5 jobs, including Customer Success and activation reminders within the 60 s limit.
2. Resend sending from pdx1, and a Resend open-tracking webhook processed end to end.
3. Brevo API calls from pdx1 (EU latency) and any Brevo webhook delivery.
4. A Stripe webhook processed end to end, and Checkout.
5. Real form submissions writing records and sending notifications.
6. Real-user speed (Speed Insights, about 28 days).

## Promotion steps

1. **Preconditions:**
   - Database region confirmed.
   - Working tree clean.
   - Staging still shows `['pdx1']`.
   - Record the rollback point: `main` `b165217`, `dpl_HnBJSqxstCGeAgnAs6ndA9RGPGUs`.
2. **Timing:** a Tuesday–Thursday, about 15–20 minutes before the hour (for example 08:40 Pacific). The hourly crons then run in pdx1 within about 20 minutes, while someone is watching. Avoid Mondays 17:00–19:00 UTC (Scout report), Fridays and weekends.
3. **Promote:** `main` and `website` have diverged, because the Weekly Picks commits were cherry-picked onto `main`. The cherry-picks are patch-identical to the `website` commits. `main` can't be fast-forwarded directly, so:
   1. Merge `origin/main` into `website` (`git merge --no-ff origin/main`). The resulting tree is identical to `website`'s; this was checked with `git merge-tree`.
   2. Push `website`. Staging rebuilds the same code, still in pdx1.
   3. Fast-forward `main` to that merge commit (`git push origin <merge sha>:refs/heads/main`).

   The only difference from Production is then the region line and docs.
4. **Verify:**
   - The deployment is Ready with `regions: ['pdx1']`.
   - `x-vercel-id` shows `::pdx1::` on happyhourcompass.com, `/website-happy-hours`, a venue page and `/api/health`.
   - The homepage smoke check and crawler HTML match.

## Observation window

- **0–2 h (active):**
  - two hourly cron cycles (Customer Success, activation reminders);
  - about 12 outbox runs and about 8 open-tracking runs;
  - Sentry, `#ops-alerts` and `#ops-critical`;
  - Vercel errors by route (5xx, timeouts), and cron durations against the 30-day baseline above.
- **2–48 h:** Resend sends and an open webhook (about daily); Sentry daily; Vercel cron durations.
- **To Monday 2026-11-02:** the first Scout report in pdx1.
- **Until it happens:** a Stripe webhook (check delivery status after the next event) and a Brevo API call.
- **About 28 days:** Speed Insights against the pre-move window.

## Rollback steps

Whoever does it needs: a Vercel team member with Production deployment rights (Wayne; or a CLI session with the team token); GitHub push to `website`/`main`; and, for verification, `curl` or the Vercel dashboard.

1. **Instant rollback:** Vercel → Deployments → `dpl_HnBJSqxstCGeAgnAs6ndA9RGPGUs` (`b165217`, iad1) → Instant Rollback, or run `vercel rollback dpl_HnBJSqxstCGeAgnAs6ndA9RGPGUs --scope team_8bFabDMUHQheF2tNTU8Mmf7R` from `operator-admin/`. It takes effect immediately; that deployment still runs in iad1, because each deployment keeps the region it was built with.
2. **Verify:** `curl -sI https://happyhourcompass.com/ | grep x-vercel-id` shows `::iad1::`, and `/api/health` returns 200. The project default region was never changed (still iad1).
3. **Note on Vercel behaviour:** after an instant rollback, Vercel stops automatically assigning the Production domain to new deployments until one is promoted. An accidental push to `main` won't go live in the meantime.
4. **Prevent reintroduction:**
   - On `website`, run `git revert <region commit>` (keep the docs) and push. Staging then returns to iad1.
   - Fast-forward `main` to the revert.
   - In Vercel, **promote** that new iad1 deployment, which re-enables automatic domain assignment.
   - Verify `::iad1::` again.

   Until the revert is done, **don't fast-forward `main` to any `website` commit that still contains `"regions": ["pdx1"]`.**
5. **Afterwards:** check that the hourly crons ran successfully on iad1, and record the outcome in the region experiment doc.

## Who does what

- **Wayne (Vercel dashboard, Sentry, Slack, Resend / Stripe / Brevo dashboards):** promotion approval, rollback authority, and the dashboard checks. Claude has no access to the Resend, Stripe or Brevo dashboards.
- **Claude (CLI with the team token, read-only metrics):** can run the git promotion, pull the Vercel metrics (cron durations, error counts, regions) and check regions with `curl`, on request.
