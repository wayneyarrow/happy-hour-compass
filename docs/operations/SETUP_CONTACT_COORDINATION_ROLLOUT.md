# Setup-contact / milestone coordination — rollout runbook

Coordinates the automatic setup-reminder worker and the Customer Success
milestone worker for operators who have not finished account setup
(`src/lib/activation/setupContactPolicy.ts`). Approved rules: 48 hours between
setup contacts and milestone emails, per operator; milestones defer to the
next business-day 3 PM local slot; reminders defer to 48 h after a milestone,
or are skipped if that reaches the setup deadline.

## What runs with the flag off

`SETUP_CONTACT_COORDINATION_ENABLED` is off by default. With it off, both
workers send exactly as before (standard milestone, no deferral, no skipped
reminders). **Evidence is still collected** on `public.operators`
(migration 104):

| Evidence | Written by | When |
|---|---|---|
| `last_setup_contact_at` / `_kind` | `sendTransactionalEmail()` | just before the provider call, for setup emails to an unactivated operator (initial setup, code emails, reminders, founder resends incl. Final resend, operator-requested recovery/setup) |
| `last_setup_pause_at` | Copy setup link | after the link is generated (not an email) |
| `last_milestone_contact_at` / `_status` | milestone worker | after the provider responds: `accepted`, or `unconfirmed` when delivery is uncertain (network error, 5xx, unknown error); nothing on a definite rejection |
| `setup_contact_claimed_at` / `_kind` | reminder & milestone workers, founder Final resend / Resend / Copy | short claim while contacting; released only after evidence is written |

Provider outcomes:

- **Setup emails** are recorded *before* sending, under the contact claim
  (accepted, uncertain and rejected sends all count — conservative: it can
  only delay a milestone).
- **Milestones**: accepted → `accepted`; uncertain → `unconfirmed` (protects
  the full 48 h, never shown as sent); definite rejection → nothing (so it
  never defers or skips a reminder).
- **Holders never release mid-request**: a started provider request can't be
  cancelled, so a holder keeps its claim until the request resolves, and must
  start it within 20 s of the claim (`runHoldingContactClaim()`), or nothing
  is sent.
- **Crash / kill mid-send**: the holder never released its claim. When the
  claim's 6-minute lifetime passes, the next reader or claimer folds it into
  the evidence columns as a possible contact of its kind (milestone →
  `unconfirmed` milestone; reminder or founder resend → unconfirmed setup
  contact; founder copy → pause). From then on the evidence lives in the
  columns, not the claim, so it protects the full 48 h.
- **Evidence write fails**: the holder keeps its claim (it is folded later)
  instead of releasing it with nothing recorded.

Founder Final resend, Resend and Copy setup link are exempt from the 48 h
rule but take the same per-operator claim (lock order: setup-link claim →
contact claim). If an automatic email is mid-send they answer "being sent
right now — wait a minute". Release refuses while either claim is active.

Automatic initial setup emails (approval / auto-approval provisioning,
deferred email-code start, legacy tracking start) take the claim too
(`initial_setup`) and are only ever sent under it. They wait up to 10 s; if
the claim is still busy they are queued (migration 105) and the hourly
operator-activation worker sends them under the claim. Only if queuing
itself fails is nothing sent (caller's failure path + `#ops-critical`).
Operator-requested emails (codes, Forgot Password, finish-setup) stay
immediate and only record evidence. See CLAUDE.md for the queue's evidence
and duplicate-protection rules.

## The six-minute claim — practical limits

The claim lifetime (`SETUP_CONTACT_CLAIM_TTL_MS`) is an engineering bound,
not a proof. It is safe because, together:

- a holder must **start** its provider request within 20 s of taking the
  claim (`runHoldingContactClaim()`; otherwise nothing is sent);
- a holder never releases while its request is unresolved;
- Node's fetch (used by the Resend SDK) stops waiting for response headers
  after 5 minutes, and Vercel functions on this project are capped at 300 s
  (Pro, fluid compute, no route overrides; crons 60 s).

What it does **not** cover:

- **Resend accepting a request after our client gave up.** No client can
  cancel a request already received; acceptance after a client-side timeout
  or a killed function can't be ruled out, only made implausible by the
  margin.
- **Inbox arrival order.** The claim orders provider requests/acceptance;
  two accepted emails can still arrive minutes apart, in either order.
- **Senders outside the claim.** Operator-requested emails (codes, Forgot
  Password, finish-setup) are deliberately immediate; they only record
  evidence.
- **Configuration drift.** Raising any holder's function `maxDuration` past
  ~5 minutes, or adding waits between a claim and its send, breaks the
  bound. Re-check this section if either changes.

Operational effects of a held or stale claim: founder Resend / Final resend
/ Copy answer "being sent right now" (up to 6 minutes after a crash); an
initial setup email is queued (sent by the hourly cron, so up to about an
hour later — never on staging, which runs no crons); an interrupted queued
send whose delivery can't be confirmed is alerted to `#ops-critical` and
never resent automatically.

## Rollout order

Each step is a separate, explicitly authorized action.

0. **Apply migration 105** (queued initial setup emails) before deploying
   this code anywhere — the initial-send path writes its columns. Columns
   only, nullable/defaulted; older code never reads them.
1. **Apply migration 104** to the shared Supabase project
   (`supabase db push --linked`, after `--dry-run` shows only 104). Columns
   only, all nullable; code that predates it never reads them. Because
   staging and production share one database, this one step serves both.
2. **Staging** — deploy `website`. Use it for QA only.
   **Staging does not start the 48-hour observation clock**: staging runs
   no workers (no `OPERATOR_ACTIVATION_REMINDERS_ENABLED` /
   `CUSTOMER_SUCCESS_EMAILS_ENABLED` on Preview, crons are Production-only),
   so it records evidence only for the few manual actions taken there.
3. **Production promotion** (separate authorization) — fast-forward `main`
   and deploy, with `SETUP_CONTACT_COORDINATION_ENABLED` **unset**. From this
   moment Production collects contact evidence (setup emails, Copy pauses,
   milestone outcomes) while sending exactly as before.
   **The 48-hour observation period starts here**, when this code is live in
   Production with evidence collection on and coordination off.
4. **Initialization** — run the SQL below **once**, after step 3 (idempotent;
   it only moves evidence forward), so contacts sent before step 3 count.
5. **Observe ≥ 48 h** after step 3. Every contact inside the first spacing
   window — including uncertain milestone outcomes that the backfill can't
   reconstruct — is then recorded live. Verify with the counts below.
6. **Enable** (separate authorization) — set
   `SETUP_CONTACT_COORDINATION_ENABLED=true` in Production and redeploy
   (Vercel applies env changes on the next deployment).

Rollback: unset the flag and redeploy. Columns can stay (written, not acted on).

## Initialization (review before running; not applied)

Conservative: takes the **latest** of every available signal, using times
that are at or after the real send (note `created_at` is written after the
send; `recovery_sent_at` is when the latest setup link was generated). Only
unactivated operators. Run once after step 2.

```sql
WITH unactivated AS (
  SELECT id, lower(email) AS email FROM public.operators WHERE account_activated_at IS NULL
),
origin_notes AS (
  SELECT l.operator_id, n.created_at, n.event_type
    FROM public.operator_activation_lifecycles l
    JOIN public.venue_claim_notes n ON n.claim_id = l.origin_claim_id
  UNION ALL
  SELECT l.operator_id, n.created_at, n.event_type
    FROM public.operator_activation_lifecycles l
    JOIN public.operator_submission_notes n ON n.submission_id = l.origin_submission_id
),
setup_contacts AS (
  SELECT operator_id, max(created_at) AS at FROM origin_notes
   WHERE event_type IN ('reminder_sent','manual_resend','legacy_activation_resumed','final_setup_email_sent','final_setup_email_unconfirmed')
   GROUP BY operator_id
  UNION ALL
  SELECT operator_id, max(started_at) FROM public.operator_activation_lifecycles GROUP BY operator_id
  UNION ALL
  SELECT u.id, a.recovery_sent_at FROM unactivated u JOIN auth.users a ON a.id = u.id WHERE a.recovery_sent_at IS NOT NULL
  UNION ALL
  SELECT u.id, max(coalesce(m.sent_at, m.created_at)) FROM unactivated u
    JOIN public.email_messages m ON lower(m.recipient_email) = u.email
   WHERE m.email_type IN ('claim_approval','operator_activation','activation_reminder','activation_final_setup','operator_verification_code','operator_setup_request','password_reset')
   GROUP BY u.id
),
pauses AS (
  SELECT operator_id, max(created_at) AS at FROM origin_notes WHERE event_type = 'final_setup_link_generated' GROUP BY operator_id
),
milestones AS (
  SELECT operator_id, max(sent_at) AS at FROM public.customer_success_events
   WHERE communication_status = 'sent' AND operator_id IS NOT NULL GROUP BY operator_id
)
UPDATE public.operators o SET
  last_setup_contact_at = GREATEST(o.last_setup_contact_at, sc.at),
  last_setup_contact_kind = CASE WHEN o.last_setup_contact_at IS NULL OR sc.at > o.last_setup_contact_at THEN 'setup_email' ELSE o.last_setup_contact_kind END,
  last_setup_pause_at = GREATEST(o.last_setup_pause_at, p.at),
  last_milestone_contact_at = GREATEST(o.last_milestone_contact_at, ms.at),
  last_milestone_contact_status = CASE WHEN ms.at IS NOT NULL AND (o.last_milestone_contact_at IS NULL OR ms.at > o.last_milestone_contact_at) THEN 'accepted' ELSE o.last_milestone_contact_status END
FROM unactivated u
LEFT JOIN (SELECT operator_id, max(at) AS at FROM setup_contacts GROUP BY operator_id) sc ON sc.operator_id = u.id
LEFT JOIN pauses p ON p.operator_id = u.id
LEFT JOIN milestones ms ON ms.operator_id = u.id
WHERE o.id = u.id
  AND (sc.at IS NOT NULL OR p.at IS NOT NULL OR ms.at IS NOT NULL);
```

`GREATEST` ignores NULLs, so existing (newer) evidence is never moved back.
`'setup_email'` is the generic kind for backfilled contacts; backfilled
milestones are `'accepted'` (only `communication_status = 'sent'` rows are
used). Milestone attempts whose outcome was uncertain before rollout are not
reconstructed (no reliable signal) — this is why the flag stays off for at
least 48 h after deploy (step 4), during which every new outcome is recorded.

Verify:

```sql
SELECT count(*) FILTER (WHERE last_setup_contact_at IS NOT NULL) AS with_setup_contact,
       count(*) FILTER (WHERE last_milestone_contact_at IS NOT NULL) AS with_milestone,
       count(*) FILTER (WHERE last_setup_pause_at IS NOT NULL) AS with_pause
  FROM public.operators WHERE account_activated_at IS NULL;
```
