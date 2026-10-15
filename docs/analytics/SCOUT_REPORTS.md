# Scout weekly reports — storage, schedule and retrieval

Scout is HHC's analytics assistant (in ChatGPT). It prepares the briefing for Wayne's Product Usage & Discovery meeting, held Mondays at 11:00 America/Vancouver.

**Stage one** (live, `c803c67`) builds the report and offers a founder-only manual download: Control Panel → Analytics → Download Scout report.

**Stage two** generates the same report automatically and stores it privately. The code is in this repository but is **disabled** until the configuration has been reviewed. Migration 112 was **applied** to the shared project on 2026-10-15 (`supabase db push --linked`, the only pending migration; ledger entry 112). Its file header still says "not yet applied" and is left byte-for-byte unchanged.

## Delivery milestones (separate; none implies the next)

1. **Automatic generation and private storage.** Built here, disabled by default.
2. **Verified retrieval by Scout.** Not yet: needs the reviewed access route below.
3. **Verified unattended briefing preparation in ChatGPT.** Not yet: needs a separate test of scheduled ChatGPT access.

## Storage — `public.scout_reports` (migration 112)

There is one row per report type, environment and reporting period. Uniqueness is enforced by `UNIQUE (report_type, environment, period_start)`.

| Field | Meaning |
|---|---|
| `id` | Stable report id |
| `report_type`, `schema_version` | `product_usage_and_discovery`; the payload's `schemaVersion` |
| `period_start` / `period_end` | Half-open `[start, end)` UTC bounds: Monday 00:00 Vancouver to the next Monday 00:00 |
| `period_start_date` / `period_end_date`, `time_zone` | Vancouver dates, Monday to Sunday |
| `generation_state` | Latest attempt: `generating` / `generated` / `failed` |
| `completeness` | Of the stored payload: `complete` / `incomplete`. Independent of generation state |
| `payload` | The full stage-one JSON export, exactly as built |
| `incomplete_sections`, `retry_advice` | Copied from the payload's `completeness` block, for listing |
| `last_failure` | Sanitized `{part, kind, message, at}`. Emails, URLs and token-like strings are removed; length is capped |
| `attempt_count`, `lease_started_at`, `last_attempt_*` | Duplicate-run protection and the attempt history |

**Environment.** It is part of the key: `production` rows are the reports, and `staging` rows exist only for staging QA. The two can never collide or be confused.

**Snapshots.** A row holding a **complete** report can never be updated: a trigger blocks it. Later venue renames, milestone changes or builder changes can't alter a stored report. A row's identity and period can never change.

**Access:**
- RLS is enabled with no policies.
- Everything is revoked from `PUBLIC`, `anon` and `authenticated`. This is explicit because this project's default privileges would otherwise grant them `ALL`.
- Only `service_role` has access.
- No view, RPC or storage bucket exposes the data.
- `listScoutReports()` and `getScoutReportById()` (`src/lib/scoutReport/storage/scoutReportStore.ts`) always take an environment and return finished reports only (`generation_state = 'generated'`). They don't authorize: the server boundary calling them must, e.g. a future founder-only page with `requireControlPanelAdmin()`.

**Retention.** The target is 26 weeks. After each successful scheduled run, rows of the same report type and environment whose period started more than 26 weeks before the current period are deleted. This touches nothing outside `scout_reports`, other report types or the other environment.

## Schedule

Vercel cron expressions are always UTC and don't support day names (vendor docs, checked 2026-10-15). On Pro, cron jobs fire within the specified minute, up to 100 per project. Delivery is best effort: a run can be missed or delivered twice, and failed invocations aren't retried.

The schedules (`SCOUT_CRON_SCHEDULES`) are in `vercel.json` (a test pins them to exactly these entries):

```json
{ "path": "/api/cron/scout-report", "schedule": "0 17 * * 1" },
{ "path": "/api/cron/scout-report", "schedule": "20 17 * * 1" },
{ "path": "/api/cron/scout-report", "schedule": "40 17 * * 1" },
{ "path": "/api/cron/scout-report", "schedule": "0 18 * * 1" },
{ "path": "/api/cron/scout-report", "schedule": "20 18 * * 1" },
{ "path": "/api/cron/scout-report", "schedule": "40 18 * * 1" }
```

**DST handling.** The route runs only when it is Monday 10:xx in Vancouver: 17:xx UTC under PDT and 18:xx UTC under PST. The other three calls each week exit before reading anything. A test checks that every Monday of a year yields exactly the 10:00, 10:20 and 10:40 local passes.

**Per pass:**
1. **Claim the period.**
   - The first pass claims the period with an atomic insert.
   - A later pass takes over only by compare-and-swap, and only when the stored report is not complete, its lease is stale (more than 10 minutes), fewer than 3 attempts have been made, and a retry could help.
2. **Build** the report with the stage-one builder, within 45 s (the route's `maxDuration` is 60 s).
3. **Store the result:**
   - Any built report is stored honestly, complete or not, with its section issues inside the payload.
   - A retry never replaces a complete report, and never replaces an incomplete one with a report that has fewer complete sections (`kept_previous`).
   - A build that throws or times out stores no payload: the row becomes `failed`, or keeps its earlier incomplete payload.
4. **Alert** `#ops-alerts` (`sendSlackAlert`) at most once per period, in Production only, when the period ends up failed or incomplete with no further attempt coming.

**Auth and gating.** The route requires `Authorization: Bearer CRON_SECRET`, which Vercel sends automatically. It reads no other request input, and it is gated by `SCOUT_REPORT_GENERATION_ENABLED === "true"`, which is scoped per environment in Vercel.

**Trigger.** The route always runs as `trigger: "scheduled"`, so in Production the Monday window always applies to anything reachable over HTTP. Only in-process code (a reviewed local verification harness) can run `trigger: "manual"`: no window, and the row is recorded as `trigger_source = 'manual'`. Staging rows are always recorded as `manual`.

**Side effects.** None beyond the row itself: no email, no operator contact, no customer-success writes, no AI calls.

**Known gap.** If every Monday delivery is missed, no row exists and no alert fires, because nothing runs to notice. Wayne would see no report for the week. A later "was the report stored?" check is possible future work.

## Scout retrieval — current test route

For the on-demand retrieval test, Scout reads `public.scout_reports` through the Supabase connection already available in its ChatGPT thread, using read-only `SELECT` queries. That connection runs as `postgres` with read-only enforcement off, so the restriction to finished reports is a query convention, not an enforced boundary. The table itself is closed to `anon`/`authenticated`.

**Checksum definition:** `encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')`, i.e. SHA-256 of the `jsonb` payload's canonical text output in Postgres. `jsonb` normalizes key order and spacing, so the value is reproducible in SQL. It is not the SHA-256 of the builder's `JSON.stringify` output.

The first stored report is a **staging QA row** (`environment = 'staging'`, `trigger_source = 'manual'`, `builder_version = 'local-qa-harness@c803c67'`), generated on 2026-10-15 by a local harness using the real builder and store. It is not a Production scheduled run.

## Scout retrieval — longer-term options (requires review; not built)

The current ChatGPT Supabase integration was observed connecting as `postgres` with read-only enforcement off. That is broader than Scout needs. It must not be used as the long-term route, and it should not be changed as part of this work.

**Option A — narrow authenticated read API (recommended)**
- `GET /api/scout/reports/latest`, `GET /api/scout/reports/{id}` and `GET /api/scout/reports?limit=N` (metadata only).
- These return only `environment = 'production'` rows with a stored payload, plus `id`, period, `report_generated_at`, `completeness`, `incomplete_sections` and the payload.
- **Auth:** `Authorization: Bearer <SCOUT_REPORT_READ_TOKEN>`, a new, Scout-only credential. It is compared in constant time, stored only in Vercel Production, and rotatable.
- **Hardening:** responses are `no-store`; there is no write method; requests are rate-limited.
- **Enforcement:** the token can read finished Scout reports and nothing else. It is not a database credential.
- **Use from ChatGPT:** a Custom GPT Action (API-key auth) or a custom MCP connector. **Neither has been tested.** Do not assume either works until one exact report has been retrieved end to end.

**Option B — dedicated database role.** This only works if Scout's client can connect with its own Postgres login. The current Supabase connector runs as the account's privileges and can't be pinned to a role, so this needs external confirmation.
- A `scout_report_reader` login role: `NOBYPASSRLS`, `default_transaction_read_only = on`, a short statement timeout.
- `SELECT` on `public.scout_reports` only.
- An RLS policy `TO scout_report_reader USING (environment = 'production' AND payload IS NOT NULL)`.
- It is a separate migration plus a new credential, and it must not alter `postgres` or `service_role`.

**End-to-end retrieval test (either option):**
1. Note one stored Production report's `id`, `period_start_date`, `report_generated_at`, `completeness` and a payload checksum (sha256 of the stored JSON), from the Control Panel or a service-role read.
2. In ChatGPT, ask Scout to retrieve that exact report by id.
3. Compare all five values and the headline numbers.
4. Confirm the token or role is refused for other tables and other environments, and that an invalid token is rejected.

**Unattended operation (milestone 3)** is a separate test. A scheduled ChatGPT task must retrieve the newest report without a person present. Whether ChatGPT's scheduled tasks can use the chosen Action or connector must be verified in ChatGPT itself; this repository can't establish it.

## Release plan

1. **Review** migration 112 and this design.
2. ~~Apply migration 112~~: done 2026-10-15. One staging QA report is stored for Scout's retrieval test.
3. **Staging QA:**
   - Set `SCOUT_REPORT_GENERATION_ENABLED=true` for Preview only, then redeploy staging (variable changes apply only to new deployments).
   - Call `/api/cron/scout-report` on staging with the `CRON_SECRET` (on staging the time window isn't enforced).
   - Expect one `staging` row with a complete payload whose figures match a staging manual download taken at the same time, a second call that skips with `already_complete`, and no Slack message.
   - Delete the staging QA row afterwards (authorized).
4. **Production:**
   - Add the six cron entries to `vercel.json` (reviewed commit).
   - Set `SCOUT_REPORT_GENERATION_ENABLED=true` for Production.
   - Promote.
   - Verify the next Monday 10:00–10:41 run in the logs, and the stored row.
5. **Retrieval:** review and build Option A (or B), then run the end-to-end retrieval test.
6. **Unattended briefing:** test a scheduled ChatGPT task against step 5.

**Rollback:**
- Unset `SCOUT_REPORT_GENERATION_ENABLED` and redeploy: the cron becomes a no-op. Vercel applies environment-variable changes only to new deployments.
- Or remove the cron entries.
- The table can stay; it is additive.
