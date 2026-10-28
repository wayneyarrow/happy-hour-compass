# Function region experiment: iad1 vs sfo1 vs pdx1 (2026-10-27)

Does running the website's functions closer to the database make the homepage faster, after Phase 2A streaming? These are throwaway preview deployments only. No project setting, staging or Production change was made. Data: [`region-experiment-2026-10-27/`](region-experiment-2026-10-27/).

## Setup

**Code under test:** `9aa07f4`, the current Production and staging code.

| Region | Branch (throwaway, not merged) | Commit | Deployment | Confirmed function region |
|---|---|---|---|---|
| iad1 (control) | `perf/homepage-region-iad1` | `0ef81b4` | `dpl_7wqdMaNfKzBEKkC49VNUY4xJt24n` | `pdx1::iad1` |
| sfo1 | `perf/homepage-region-sfo1` | `b061785` | `dpl_Bgmc2ttpP2xnSFveWh61Yhn6nBfs` | `pdx1::sfo1` |
| pdx1 | `perf/homepage-region-pdx1` | `e4d4026` | `dpl_32QFKeXG5bf7k2Q71fpJACpmK8hz` | `pdx1::pdx1` |

- **Isolation:**
  - Each branch differs from `9aa07f4` only by `"regions": ["<region>"]` in `operator-admin/vercel.json`.
  - All three are generic Preview deployments, so they have identical Preview environment variables.
  - The `website`-only variables (Brevo, Stripe, flags) aren't read by the homepage.
- **Region confirmed** from the deployment record (`regions`), the `x-vercel-id` response header and Vercel's `function_region` metric, before any measurement.
- **The whole deployment moved:** the setting applies to every function in the deployment, not just the homepage. Requests from the test machine enter Vercel at the Portland edge (`pdx1::…`).
- **Next's `preferredRegion` doesn't work here.** The per-route setting was tried first and is ignored for this Node.js page on Vercel: the homepage stayed in iad1.
- **Conditions:** tests ran 18:15–19:15 UTC from the Pacific Northwest, with the deployments alternated run by run and tracking blocked. Every audit reported no unblocked tracking requests.

## A/A noise floor

The first `preferredRegion` attempt left both previews running identical code in iad1. Measured against each other (10 alternating runs, `hero-aa.jsonl`):
- **Hero arrival:** 1200 vs 1198 ms.
- **Full document:** 2529 vs 2742 ms.

So hero arrival agrees to within a few ms, while the full document varies by about 200 ms on noise alone.

## Homepage HTML (`heroTiming.cjs`, 10 alternating runs per round, ms)

| Region | Round 1 hero (18:47 UTC) | Median | Round 2 hero (19:12 UTC) | Median | Full document medians, rounds 1 / 2 |
|---|---|---|---|---|---|
| iad1 | 3302 1227 1642 1184 1475 1345 1521 1550 1356 1268 | 1416 | 1842 1491 1236 1528 1394 1117 1054 1265 1510 1182 | 1330 | 3044 / 2946 |
| sfo1 | 700 636 632 773 781 603 694 593 625 599 | **634** | 806 815 734 989 811 813 654 770 671 860 | **809** | **1413 / 1577** |
| pdx1 | 740 1142 760 735 1017 1053 701 798 705 755 | **758** | 1349 804 692 775 724 712 662 725 751 786 | **738** | **1707 / 1577** |

Both West Coast regions bring the hero in about 0.55–0.8 s sooner and the full document about 1.3–1.6 s sooner than iad1. That's far beyond the A/A noise. Between sfo1 and pdx1 the result flips from round to round, so they can't be separated on HTML timing.

## Lighthouse, homepage (mobile, DevTools throttling, 3 alternating rounds)

| Region | Cold FCP = LCP per run | Cold median | Warm FCP / LCP median | CLS | Score, cold / warm |
|---|---|---|---|---|---|
| iad1 | 2787 2942 2743 | 2787 ms | 1418 / 1418 ms | 0 | 88 / 98 |
| sfo1 | 2157 2684 2382 | **2382 ms** | 870 / 897 ms | 0 | 88 / 98 |
| pdx1 | 3022 2770 2382 | 2770 ms | 880 / 880 ms | 0 | 87 / 99 |

- **Cold loads:** on a throttled phone these are mostly downloading CSS/JS, so the server gain is diluted. sfo1 was about 0.4 s better; pdx1's three runs (2.38–3.02 s) overlap iad1's.
- **Warm loads:** both West Coast regions are about 0.5 s faster.

## Server and database (Vercel metrics, `/`, about 27 renders per deployment, mostly hot)

| | iad1 | sfo1 | pdx1 |
|---|---|---|---|
| Server time per render, hot (p50 / p90) | 2662 / 3392 ms | **1292 / 2060 ms** | 1645 / 2463 ms |
| First render after deploy (prewarmed instance, single sample) | 3940 ms | 2702 ms | 3059 ms |
| CPU per render (p50) | 540 ms | 550 ms | 580 ms |
| Time to first byte (p50) | 1123 ms | **463 ms** | 663 ms |
| Supabase request (p50 / p90 / fastest), 1296 requests each | 144 / 272 / 89 ms | **73 / 169 / 23 ms** | 94 / 165 / 42 ms |

- **CPU is unchanged.** The whole gain is shorter waits on the database, about 48 requests per render in up to about 12 sequential steps.
- **Cold starts:** each deployment had only one prewarmed start, so cold behaviour is a single sample per region. True cold starts weren't separately identified.

## Database region

The fastest Supabase round trip is 23 ms from sfo1, 42 ms from pdx1 and 89 ms from iad1. That's consistent with the pooler host the Supabase CLI recorded (`aws-1-us-west-1`, Northern California), but it's runtime evidence, not a direct read of the project setting. The Supabase MCP server isn't authorized and the CLI token lacks `projects_read`; confirm in Supabase → Project Settings → General.

## Other routes (same deployments; full document, 5 alternating runs, ms)

| Route | iad1 | sfo1 | pdx1 |
|---|---|---|---|
| `/website-happy-hours` | 1267 | 753 | 775 |
| `/central-okanagan/kelowna/train-station-pub` | 898 | 536 | 556 |

These measure the server response only, with no browser.

## Functional checks (sfo1 and pdx1 against the iad1 control)

- **Identical on mobile and desktop:**
  - sections and order, including Local Favourites and Today's Specials with the comped venues;
  - both Weekly Picks placements, metadata, JSON-LD and discovery payloads, with CLS 0.
- **Market switching:** works, and its server action runs in the deployment's region.
- **Crawlers:** Googlebot and Facebook user agents get complete in-order HTML; `private, no-store`, `MISS`.
- **Fallbacks:** JavaScript off, scripts not running and an interrupted response all show the browse links, reachable by keyboard.
- **Not run in the new regions:** the other checks on non-homepage routes (forms, server actions, Operator Admin, Control Panel, crons and webhooks); only server timing was measured for two pages.

## Cost (Vercel Fluid compute, [pricing page](https://vercel.com/docs/functions/usage-and-pricing), read 2026-10-27)

| Region | Active CPU | Provisioned memory |
|---|---|---|
| iad1 | $0.128 per hour | $0.0106 per GB-hour |
| pdx1 | $0.128 per hour | $0.0106 per GB-hour |
| sfo1 | $0.177 per hour (+38%) | $0.0147 per GB-hour (+39%) |

**HHC Production usage, last 30 days (Vercel metrics):**
- About 7.0 Active CPU hours. The homepage accounts for about 5.4 of them; it's mostly uptime and link-preview bots.
- About 66 GB-hours of function memory (2 GB functions) and about 111,000 invocations.

**Estimate**, assuming usage stays the same and treating the memory metric as approximately the billed provisioned memory (under Fluid compute's concurrency, the bill may differ):

| | Monthly compute |
|---|---|
| iad1 (today) | about $0.90 CPU + $0.70 memory = **$1.60** |
| sfo1, same usage | about $1.24 + $0.97 = **$2.21** (+$0.61) |
| sfo1, if memory-hours fall about 40% with shorter renders (assumption) | about **$1.82** (+$0.22) |
| pdx1, same usage | **$1.60** (no change) |
| pdx1, if memory-hours fall about 35% | about **$1.35** (−$0.25) |

Either way the difference is cents a month, well inside the Pro plan's monthly usage credit. Invocation pricing doesn't vary by region.

## Portland (pdx1) compatibility review (2026-10-27)

Environment: the isolated pdx1 preview `dpl_32QFKeXG5bf7k2Q71fpJACpmK8hz`, with the iad1 preview `dpl_7wqdMaNfKzBEKkC49VNUY4xJt24n` as control. Both are generic Preview deployments, so they **don't have** the `website`-only variables: Stripe secret and price IDs, Brevo, `RESEND_WEBHOOK_SECRET`, `CRON_SECRET`, `BREVO_WEBHOOK_TOKEN` and feature flags. They share the Supabase project with Production. Nothing was written to it.

### What moves in a whole-application region change

All server-side work moves; middleware does not.
- **Pages:** 117 `page.tsx` files, rendered on demand, including the website, consumer app, Operator Admin and Control Panel.
- **Server actions:** 60 files.
- **API routes:** 26, covering `/api/track/*`, `/api/consumer/*`, `/api/preview/*`, `/api/impersonate/start` and `/api/health`.
- **Webhooks:** Stripe, Resend and Brevo.
- **Crons:** the 5 scheduled jobs in `vercel.json`. Schedules are UTC and stay the same; each run would execute in the new region.
- **Middleware is unaffected.** Vercel runs Routing Middleware in every region regardless of the setting. Static files and prerendered pages (`/robots.txt`, `/login`, `/control-panel-login`, 404) are served from the CDN.

### Region-sensitive code (code inspection)

- **No code reads the function region.** Nothing uses `VERCEL_REGION`, and no per-route region config is honoured (`preferredRegion` was ignored).
- **Visitor geolocation:** claim auto-approval reads `x-vercel-ip-*` headers. Vercel's edge sets these from the visitor's IP, so the function region doesn't change them.
- **Site URL:** `siteUrl.ts` uses `VERCEL_URL` and env vars, which are region-independent.
- **Timeouts:** Slack 4 s, Turnstile 8 s, Brevo 10 s, industry-feed fetches 5 s, crons `maxDuration` 60 s. The setup-contact claim relies on a send starting within 20 s and functions being capped at 300 s; region-related latency changes are tens of ms, far inside these bounds.
- **Next.js data cache:** Vercel keeps it per region (`iad1.suspense-cache…`), so it would start cold in a new region.
- **No outbound IP allowlisting:** Supabase is reached over its public REST API, and Google Places, Resend, Brevo, Slack and Stripe use API keys or signatures. Vercel functions have no fixed egress IPs without Secure Compute, so any IP restriction would already be failing today. This is an inference; the API key restrictions weren't checked in the providers' dashboards.

### Outbound latency (Vercel metrics)

| Service | p50 from Production iad1 (30 days) | p50 from iad1 preview | p50 from pdx1 preview |
|---|---|---|---|
| Supabase | 166 ms | 143 ms | **91 ms** |
| Cloudflare Turnstile | 39 ms | 77 ms | 53 ms |
| Sentry ingest | 29 ms | 26 ms | 57 ms |
| Resend / Slack / Brevo / Google Places | 92 / 49 / 418 / 298 ms | — | not measured (no safe trigger) |

### Checks on the pdx1 preview

| Check | Result | Basis |
|---|---|---|
| 36 routes: website pages; a venue, event, guide and collection; sign-in and password pages; sitemap; robots; 404 | Same status as iad1 (0 mismatches); function responses from `pdx1::pdx1` | Verified (HTTP only, no browser) |
| Homepage functional, crawler, cache and fallback checks | Identical to iad1 | Verified (see above) |
| Market switch server action | Ran in pdx1; cookie set; page refreshed | Verified |
| Contact form server action, fake Turnstile token | Ran in pdx1, called Cloudflare Siteverify and showed the standard failure message. Returns before the insert, email or Slack | Verified, plus code inspection for the no-write path |
| `/admin`, `/control-panel` signed out | 307 to their sign-in pages (middleware) | Verified |
| `/api/health` (read-only Supabase check) | 200 | Verified |
| Stripe webhook, no signature / bogus signature | 400 / 400 "Invalid signature" on both regions; nothing processed, no alert | Verified |
| 5 cron routes, no credentials | 500 "Not configured" (`CRON_SECRET` isn't on generic previews); no work done | Verified the gate only |
| Resend and Brevo webhooks | Not called: with their secrets missing on generic previews, both raise a Slack alert | Untested |
| Operator Admin and Control Panel signed-in flows | Not tested: no test credentials, and sign-in writes (login notifications) to the shared database | Untested |
| Emails (Resend), Brevo calls, Stripe API calls, real cron runs, submitting forms | Not run (real sends, writes or billing) | Untested; code inspection only |

## Staging trial: pdx1 via `vercel.json` (2026-10-27)

- **Change:** `d8a4f5d` on `website` adds `"regions": ["pdx1"]` to `operator-admin/vercel.json`, after the docs-only commit `296c81f`. No other application file changed.
- **Staging:** `dpl_4buej6LkQ3ZFfZZFHAmzdB6kNu8t`. The deployment record lists `['pdx1']`, and every function response comes from `pdx1::pdx1`: pages, navigation requests, `/api/health`, webhooks and crons. Static files and middleware redirects come from the CDN or edge.
- **Control:** the previous staging deployment `dpl_29Zr95wse2XuZK7W5CakinarxzWB`. It has the same `website` environment and application code, in iad1.
- **Unchanged:** Production stays `dpl_94x4iTNnCuCMZjZcEBcs3p1MNPtB` (`main` `9aa07f4`), still `pdx1::iad1`. The project default region is still `['iad1']`.

### Timing, staging pdx1 vs the iad1 control (alternating, 19:52–19:54 UTC)

| | iad1 control | pdx1 staging |
|---|---|---|
| Homepage hero, per run (ms) | 1915 1290 1241 1108 1281 1196 1354 1422 1169 1179 | 626 909 694 3959 772 2509 726 795 864 678 |
| Homepage hero / full document, median | 1261 / 3021 ms | **784 / 1745 ms** |
| Happy Hours full document, 5 runs | 1419 1175 1260 1028 1585 (median 1260) | 675 699 797 739 1136 (median 739) |
| Train Station Pub full document, 5 runs | 1123 887 817 913 918 (median 913) | 808 549 519 612 514 (median 549) |

The two slow pdx1 homepage runs (3959 and 2509 ms) look like new instances starting on a brand-new deployment.

### Verified on staging (pdx1)

- **Homepage:** identical to the iad1 control on mobile and desktop. Sections and order (Local Favourites, Today's Specials, comped venues), both Weekly Picks placements, metadata, JSON-LD and discovery payloads all match, CLS 0, and no tracking request got through.
- **Market switching:** works, and its server action runs in pdx1.
- **Route sweep:** 31 routes, with statuses identical to the control.
- **Crawlers:** complete HTML for Googlebot and Facebook user agents; `private, no-store`, `MISS`. Fallbacks work with JavaScript off and with scripts not running, and are keyboard-reachable.
- **Webhook and cron gates** (pdx1 and the control behave identically):
  - Stripe, bogus signature: 400.
  - Resend, unsigned: 401.
  - Brevo, wrong token: 401.
  - All 5 crons, no credentials: 401.

  Nothing behind these gates ran.
- **Unit tests** for email tracking, Brevo, Stripe, subscriptions, activation, Customer Success and the Scout report: 1,530 pass. This logic doesn't depend on region.

### Side effects and test facilities (not run)

| Flow | Side effects if run | Test facility available | Status / proposed verification |
|---|---|---|---|
| Stripe webhook processing and Checkout | Writes `venue_subscriptions` / `plan_change_events` in the shared database; Slack plan-change alerts | Staging uses Stripe test mode (2026-10-10 QA) | Untested. Needs an authorized QA session with a QA venue and cleanup, as on 2026-10-10. |
| Resend sends (transactional email) | Real email; `email_messages` registry rows | Resend's test recipients (`…@resend.dev`) still write registry rows | Untested. First real sends would be after promotion: monitor the Resend dashboard and Sentry. |
| Resend open-tracking webhook | `email_provider_events` rows; Slack `#customer-success` | — | Untested past the signature gate. |
| Brevo API and webhook (Weekly Picks DOI, sync outbox) | Brevo contacts, DOI emails, outbox rows | Brevo has no sandbox in use | Untested past the token gate. |
| Crons (5) | Database writes, emails, Slack | Vercel runs crons in Production only. `activation-reminders:dry-run` runs locally only | Not verifiable on staging. Check the first runs after promotion (cron logs, Sentry, `#ops-alerts`), with instant rollback ready. |
| Form submissions (contact, suggest, add venue, claim, signup) | Database rows, emails, Slack | Turnstile-gated | The action path was verified earlier with a fake token (no write); real submissions untested. |
| Operator Admin / Control Panel signed in | Sign-in records login notifications | Wayne's staging accounts | Wayne's read-only checks (below). |

### Rollback

- **Staging:** revert `d8a4f5d` on `website` and push. The new staging deployment uses the project default (iad1); confirm `x-vercel-id` shows `::iad1::` and the deployment record shows `['iad1']`.
- **Production, if pdx1 is ever promoted:**
  1. Vercel instant rollback to the previous Production deployment. Each deployment keeps the region it was built with, so iad1 returns immediately with no rebuild.
  2. Instant rollback doesn't change the project setting (which stays iad1) or `vercel.json`. After a rollback, Vercel stops automatically assigning the Production domain to new deployments until one is promoted, so the next step must be deliberate.
  3. Revert the region commit on `website`, fast-forward `main` and promote that deployment, so `main` doesn't reintroduce pdx1.
  4. Verify `::iad1::` on the Production domain.

**Important:** `website` now contains the pdx1 line. Any future fast-forward of `main` to `website` will move Production to pdx1. Decide on the region, or revert the line, before promoting any other website work.
