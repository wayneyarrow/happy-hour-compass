# Email Open Tracking — Staging Verification Runbook

Scope: verify one real "Email opened" end to end before any production enablement. Phase 1 covers automated Customer Success milestone emails only. Design reference: `CLAUDE.md` → "Email send registry & open tracking".

**An "Email opened" event exists only for an email sent from a domain with Resend open tracking enabled.** In phase 1 that is only `updates.happyhourcompass.com`. The root domain `happyhourcompass.com` must never have open or click tracking enabled.

Every step below needs explicit approval at the time it is performed. Nothing in this runbook enables tracking in Production.

---

## 0. Before you start — production milestone sending stays unchanged

Production milestone emails keep the existing path as long as `EMAIL_OPEN_TRACKING_ENABLED` is **not** set in the Vercel Production environment. Check this before, during, and after the staging test:

1. **Vercel → Project → Settings → Environment Variables:** `EMAIL_OPEN_TRACKING_ENABLED` and `EMAIL_TRACKED_SENDER_DOMAIN` are absent for **Production**.
2. **Script proof (no send):** every run of the verification script prints
   `Production check — a milestone with EMAIL_OPEN_TRACKING_ENABLED unset is sent as: From Wayne <wayne@happyhourcompass.com> · Reply-To wayne@happyhourcompass.com · tags: none`.
   Any other output means stop.
3. **After the next real milestone:** in the Resend dashboard (Emails), the milestone shows From `wayne@happyhourcompass.com` with no tags, and this query returns 0:
   ```sql
   select count(*) from public.email_messages where environment = 'production';
   ```
   (The registry only writes when the flag is on.)

---

## 1. Apply migration 102

1. Apply `supabase/migrations/102_email_open_tracking.sql` through the authorized migration path. It creates `email_messages` and `email_provider_events` (RLS on, service role only) and changes no existing table.
2. Verify:
   ```sql
   select count(*) from public.email_messages;        -- 0
   select count(*) from public.email_provider_events; -- 0
   ```
   With every flag off, nothing writes to these tables.

---

## 2. Test venue

The script only links its email to an existing venue named exactly **`HHC Verification Test Venue`**. It refuses zero or multiple matches.

**As of 2026-09-29 no such venue exists** (the script's dry run reported `found 0`, and no submission remains under that name). Before the test, create it in the Founder Control Panel:
- name exactly `HHC Verification Test Venue`
- **unpublished**
- no operator attached

The created venue is visible in `venues` like any other row; delete it (or leave it unpublished) after the test.

---

## 3. Resend + DNS: tracked subdomain

1. Resend → Domains → **Add domain** `updates.happyhourcompass.com` (same region as the root domain, us-east-1).
2. Publish exactly the DNS records Resend shows for it. Typically:
   - DKIM TXT at `resend._domainkey.updates`
   - SPF TXT and bounce MX at `send.updates`

   DMARC is inherited from the existing `happyhourcompass.com` policy. No change is needed on the root domain's records.
3. Wait for Resend to show the domain **Verified**.
4. On **`updates.happyhourcompass.com` only** → Configuration → Enable tracking:
   - enter a tracking subdomain (e.g. `links.updates`)
   - add its CNAME record
   - turn on **Open tracking**
   - leave **Click tracking OFF**
5. Leave `happyhourcompass.com` untouched: open tracking off, click tracking off.

The script's preflight checks all of this read-only and refuses to send unless:
- the subdomain is verified with open tracking on and click tracking off
- the root domain has both off

---

## 4. Webhook + Preview variables

1. Resend → Webhooks → **Add endpoint** `https://staging.happyhourcompass.com/api/webhooks/resend`, events: **`email.opened` only**.
2. Vercel → Environment Variables → **Preview**: set `RESEND_WEBHOOK_SECRET` to that endpoint's signing secret. Redeploy the `website` branch so the running deployment picks it up.
3. Confirm the endpoint is reachable from outside. If Vercel Deployment Protection covers Preview, Resend's POST will be rejected before it reaches the app; the Brevo webhook has the same requirement.
4. **Not needed for this test:** `EMAIL_OPEN_TRACKING_ENABLED` / `EMAIL_TRACKED_SENDER_DOMAIN` in Preview. The script enables tracking for its own process only. Setting them in Preview would track every email sent from staging, which is a separate decision.

Resend webhooks are account-wide: this endpoint will receive opens for any email sent from the tracked subdomain. Before production enablement that is only the test email.

---

## 5. The one-email test

Run from `operator-admin/`. The script uses `.env.local`: the shared database and the Resend account. The registry row is recorded with environment `development`, so it can never post to Slack.

1. **Dry run** (default; sends nothing):
   ```bash
   npm run email-open-tracking:verify -- --to <your-test-inbox>
   ```
   Expect `DRY RUN complete — preflight passed.`, the production check line from §0, and a planned email From `Wayne <wayne@updates.happyhourcompass.com>` with Reply-To `wayne@happyhourcompass.com`.
2. **Send exactly one email:**
   ```bash
   npm run email-open-tracking:verify -- --to <your-test-inbox> --send
   ```
   The script:
   - sends one `[HHC open-tracking test]` 50-view milestone email through `sendTransactionalEmail`
   - links it to the test venue only (no `customer_success_events` row, no Customer Success cron)
   - prints `email_messages.id`, `send_ref`, `provider_message_id` and `sent_from_domain`

   If `sent_from_domain` is not the subdomain, it warns and exits 1. **Do not re-run blindly after a failure** — check the Resend log first.
3. **Open the email** in the test inbox with images enabled.
4. **Check status** (read-only):
   ```bash
   npm run email-open-tracking:verify -- --status <email_messages.id>
   ```

---

## 6. Expected results

| Where | Expected |
|---|---|
| Inbox | From `Wayne <wayne@updates.happyhourcompass.com>`; replying goes to `wayne@happyhourcompass.com`. |
| Resend → Emails | One email, tags `hhc_send_ref`, `hhc_email_type=customer_success_milestone`, `hhc_env=development`; status moves to *Opened*. |
| Resend → Webhooks | One or more `email.opened` deliveries to the staging endpoint with **200** responses. |
| `email_messages` row | `email_type = customer_success_milestone`, `environment = development`, `venue_id =` test venue, `customer_success_event_id` null, `status = sent`, `sent_from_domain = updates.happyhourcompass.com`, `first_opened_at` set, `open_notified_at` **null**. |
| `email_provider_events` | Exactly one `outcome = 'first_open'` for the row; any further opens are `repeat_open`. |
| Control Panel → test venue → Internal Notes | One entry: **"Email opened — 50-view milestone email to &lt;inbox&gt;, sent &lt;time&gt;."**, author "Happy Hour Compass", dated at the first open. |
| Slack `#customer-success` | **Nothing** (non-production row). |
| `customer_success_events` | Unchanged. |

```sql
select id, email_type, environment, venue_id, customer_success_event_id, status,
       sent_from_domain, provider_message_id, first_opened_at, open_notified_at
from public.email_messages where id = '<email_messages.id>';

select outcome, occurred_at, received_at, processed_at
from public.email_provider_events where email_message_id = '<email_messages.id>'
order by occurred_at;

-- Opens that could not be matched (should be empty):
select * from public.email_provider_events where processed_at is null or outcome = 'unmatched';
```

Troubleshooting:
- **No open after a few minutes:** check Resend shows *Opened*. Some clients block images; privacy proxies can also open immediately.
- **Webhook shows 401:** the secret is wrong, or the deployment wasn't redeployed after setting it.
- **Webhook shows 500:** the migration is missing, or the secret is unset (this also raises an `#ops-critical` alert).
- **Event stored but unmatched:** the cron route `/api/cron/email-open-tracking` retries matching. On staging, trigger it manually with the `CRON_SECRET` bearer token; Vercel Cron runs only in Production.

---

## 7. Rollback

Each step is independent. Nothing here affects production milestone sending, which never used the new path.

1. **Stop tracked sending anywhere it was enabled:** unset `EMAIL_OPEN_TRACKING_ENABLED` (safe at any time). Leave `EMAIL_TRACKED_SENDER_DOMAIN` unchanged for 24h after the last tracked send, so an in-flight retry can still replay its original request. Then remove it.
2. **Resend:** turn off open tracking on `updates.happyhourcompass.com`, delete the webhook endpoint, and optionally remove the domain and its DNS records (after the 24h window above).
3. **Vercel Preview:** remove `RESEND_WEBHOOK_SECRET`; redeploy.
4. **Data:** test rows are inert. To remove the test email's data:
   ```sql
   delete from public.email_provider_events where email_message_id = '<email_messages.id>';
   delete from public.email_messages where id = '<email_messages.id>';
   ```
   Delete or keep unpublished the test venue.
5. **Schema:** only if abandoning the feature entirely:
   ```sql
   drop table public.email_provider_events;
   drop table public.email_messages;
   ```
   Code with the flag off never touches these tables. The Control Panel timeline loader logs and ignores a missing table.

The privacy-policy wording ships with the code regardless and describes tracking as something emails "may" contain.

---

## 8. After a successful staging test

Production enablement is a separate approval:
- a production webhook endpoint and secret
- `EMAIL_OPEN_TRACKING_ENABLED=true` and `EMAIL_TRACKED_SENDER_DOMAIN=updates.happyhourcompass.com` in Production
- a deploy (so the 15-minute retry cron runs)

Choose a time when no milestone email is mid-retry. After enablement, the next milestone should arrive from `wayne@updates…`; its first open posts one "Email opened" message to `#customer-success`.
