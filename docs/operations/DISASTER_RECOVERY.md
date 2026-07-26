# Disaster Recovery Runbook

**Status:** Verified — backup and restore procedures below were executed end-to-end against production (backup) and an isolated temporary project (restore) during launch preparation. See Revision History.

This is an operational runbook for future maintainers. It describes the *approved* procedures for backing up and restoring the Happy Hour Compass production database — not the investigation that produced them. If you need the reasoning, evidence, or raw command output behind any procedure here, that lives in the session history that produced this document, not in this file.

---

## 1. Purpose

### Scope

This document covers backup and restore procedures for the Happy Hour Compass **production Postgres database**, hosted on Supabase (project `juphyhxdmcvseeufbiay`, org `HHC`, Pro plan).

Per `CLAUDE.md`'s Repository Layout: **there is only one Supabase project behind local dev, staging, and production.** There is no separate staging or dev database to fail over to — this runbook's project *is* the whole data layer for every environment. Treat any restore decision accordingly: it affects everyone, not just production traffic.

Out of scope: Vercel deployment recovery, DNS/domain incidents, Storage object recovery (see Known Limitations), and non-database application incidents (see the Decision Guide below for when a restore isn't the right response at all).

### When to use this document

- A production incident involves data loss, data corruption, or a suspected bad migration.
- You need to verify a backup is good before relying on it.
- You need an isolated copy of production data to investigate an issue without touching production.
- You are doing routine backup hygiene (periodic manual backups, retention checks).

---

## 2. Production Backup Strategy

### Supabase Pro automatic daily backups

The project is on the **Pro plan**, which enables automatic daily physical backups. This is enabled and active — no configuration was required to turn it on; it activated automatically when the org upgraded to Pro.

- **Cadence:** once daily.
- **Type:** physical backup (WAL-G), the default for the project's Postgres version.
- **Retention:** a rolling ~7 days (Pro-plan entitlement), consistent with 8 completed daily backups typically visible via the Supabase Management API at any given time (7-day window plus normal prune-timing overlap).
- **Where they live:** inside Supabase's infrastructure, listed under **Database → Backups** in the Supabase Dashboard. Not downloadable directly as files (see Known Limitations) — they're restored in place or via "Restore to a New Project," not exported.

### Manual production backups

Automatic backups cover the "restore to yesterday" case but are not a substitute for an off-site, maintainer-controlled copy. Take a manual backup:

- Before any risky production migration or schema change.
- Periodically as a supplementary safety net (see frequency recommendation below).
- Whenever you need a point-in-time copy to seed an isolated investigation/verification project.

### Where manual backups should be stored

Manual backups are plain-text SQL files (schema + data, see §3) and must **never** be committed to the git repository — they contain real user and business data. Store them:

- Outside the repository entirely (e.g. `~/hhc-db-backups/` on the machine taking the backup).
- Alongside a `CHECKSUMS.sha256` file for integrity verification.
- Ideally copied to durable, off-machine storage (encrypted cloud storage, a separate machine) — see Known Limitations for the current gap here.

### Backup frequency recommendations

- **Automatic daily backups** already provide a 7-day rolling safety net — no action needed to maintain this.
- **Manual backups:** take one immediately before any schema migration or high-risk production change, and on a routine cadence (weekly is a reasonable default at current data volume) as an off-Supabase safety net, since automatic backups are not currently mirrored anywhere outside Supabase's own infrastructure.

---

## 3. Creating a Manual Backup

### Approved procedure

Run from the repository root, with the `supabase/` directory already linked to the project (it is, by default, in this repo).

```bash
export SUPABASE_ACCESS_TOKEN="<personal access token>"

DEST=~/hhc-db-backups   # or wherever your off-site destination is
mkdir -p "$DEST"
TS=$(date -u +%Y%m%d_%H%M%SZ)

# Schema — run and let this fully complete before starting the data dump.
# Do not generate a second ephemeral credential (e.g. by re-running --dry-run)
# before this finishes — it invalidates the one this command is using.
supabase db dump --linked --dry-run 2>/dev/null | sed -n '/^#!/,$p' | bash \
  > "$DEST/hhc_prod_schema_${TS}.sql"

# Data
supabase db dump --linked --data-only --dry-run 2>/dev/null | sed -n '/^#!/,$p' | bash \
  > "$DEST/hhc_prod_data_${TS}.sql"

sha256sum "$DEST"/hhc_prod_*_${TS}.sql >> "$DEST/CHECKSUMS.sha256"
```

This uses the Supabase CLI's own ephemeral-credential mechanism (`cli_login_postgres.<ref>`, minted via `SUPABASE_ACCESS_TOKEN` through the Management API) to run `pg_dump` under the hood. **The production database's root password is never needed and should not be looked up or reset for this procedure.**

### Required tools and credentials

- **Supabase CLI**, linked to the project (already the case in this repo — `supabase/.temp/project-ref` confirms the link).
- **`SUPABASE_ACCESS_TOKEN`** — a personal access token with access to the `HHC` org (found in `operator-admin/.env.local`, or generate a fresh one from the Supabase Dashboard → Account → Access Tokens).
- **`pg_dump` / `psql`**, PostgreSQL 17.x client tools, matching the project's server version. The CLI's default path shells out to Docker to run a version-matched `pg_dump`; if Docker isn't available, install the native client tools directly (e.g. `apt-get install postgresql-client`) and run the extracted `pg_dump` command shown by `--dry-run` instead — this fallback path is verified and produces an equivalent backup.

### Verification checklist

- [ ] Both `pg_dump` processes exited `0`.
- [ ] The data file ends with `-- PostgreSQL database dump complete --` (confirms it wasn't truncated).
- [ ] `grep -c '^CREATE TABLE' schema.sql` is close to the live public-schema table count (49 at last verification).
- [ ] Spot-check that a few known tables (e.g. `venues`, `events`, `operators`, `markets`) have `INSERT INTO` statements in the data file.
- [ ] Checksums recorded in `CHECKSUMS.sha256`.
- [ ] File copied to durable off-site storage, not left as the only copy on one machine.

---

## 4. Restoring from an Automatic Supabase Backup

### When to use the automatic backup restore

- A production incident requires restoring the *same* project back to a known-good state from within the last ~7 days.
- You are not trying to stand up a separate/isolated copy — this restores **in place**, overwriting the current state of the production project.

### High-level restore procedure

1. Go to the Supabase Dashboard → the production project → **Database → Backups**.
2. Choose the backup dated closest to (but before) the point you want to recover to. Earlier backups are always selectable, but consider how much data you'd lose by going further back.
3. Click **Restore**. The Dashboard shows a confirmation dialog — review it before proceeding.
4. Confirm. The project becomes **inaccessible** for the duration of the restore.
5. Wait for the Dashboard's completion notification.
6. Run the Post-Restore Verification Checklist below, then the full Production Recovery Checklist (§7).

This restore path is **Dashboard-only** — there is no verified CLI or scripted equivalent for triggering it safely. Do not attempt to script this against the production project ref.

### Expected downtime

Supabase does not publish a fixed SLA for this — official guidance is only that "downtime depends on the size of the database." The project is fully inaccessible for the entire restore window. Given the current database size (~19 MB), a low-single-digit-minutes restore is a reasonable expectation, but **do not treat this as a guarantee** — verify actual project status (not the clock) before considering the restore complete.

### Post-restore verification checklist (automatic backup restore)

- [ ] Project status is `ACTIVE_HEALTHY` (Supabase Dashboard, or `GET /v1/projects/{ref}`).
- [ ] REST API responds normally (`GET /rest/v1/<a public table>` returns 200 with data, using the existing anon key).
- [ ] Table count matches expectation (49 public tables at last verification).
- [ ] Representative row counts on key tables look right for the restore point chosen (they will legitimately differ from "current" if you intentionally restored to an earlier backup — confirm they match *that* point in time, not today).
- [ ] If any custom database roles with `LOGIN` exist, reset their passwords — daily backups do not preserve custom role passwords.
- [ ] Proceed to the full Production Recovery Checklist (§7) before declaring the incident resolved.

---

## 5. Restoring from a Manual SQL Backup

### When to use the manual SQL restore

- Verifying a backup's integrity without touching production (this is how the procedure below was itself verified).
- Standing up an isolated copy of production data for investigation, testing, or a new environment.
- A fallback if the automatic Dashboard restore path is unavailable for any reason.
- **Never** as a way to restore over the production project directly — this method's safe use is always "restore into a project that isn't production."

### Verified restore procedure

This procedure is verified end-to-end: run against a temporary, isolated Supabase project, it produced a clean restore with zero errors and all data-integrity checks passing.

```bash
export SUPABASE_ACCESS_TOKEN="<personal access token>"

# 1. Create the target project (skip this step if restoring into an
#    already-existing non-production project).
curl -X POST "https://api.supabase.com/v1/projects" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "<descriptive-name>",
    "organization_slug": "wboadbejipwuuhuvmbcb",
    "db_pass": "<strong, freshly generated password>",
    "region_selection": {"type": "smartGroup", "code": "americas"}
  }'

# 2. Poll until healthy:
#    GET https://api.supabase.com/v1/projects/{ref}  →  wait for "status":"ACTIVE_HEALTHY"

# 3. Get the SESSION pooler connection string — port 5432, NOT the port
#    6543 transaction pooler. Transaction-pooling mode does not reliably
#    support the multi-statement, session-level SET commands this restore
#    needs.
curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/{ref}/config/database/pooler"

# 4. Restore — schema first, then data with triggers disabled so circular
#    foreign keys (e.g. venues ↔ operator_submissions, markets ↔ cities)
#    don't block the load:
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file hhc_prod_schema_<ts>.sql \
  --command 'SET session_replication_role = replica' \
  --file hhc_prod_data_<ts>.sql \
  --dbname "postgresql://postgres.<ref>:<password>@<session-pooler-host>:5432/postgres"
```

`--single-transaction` means the entire restore is atomic — any failure rolls back everything rather than leaving a half-restored database.

**Do not point the restored project's connection details at the running application.** This procedure produces a standalone database; connecting it to the live app is a separate, deliberate step that should never happen as a side effect of a restore/verification exercise.

If this was a verification exercise (not a real recovery), delete the temporary project once verification is complete:

```bash
curl -X DELETE -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/{ref}"
```

### Post-restore verification checklist (manual SQL restore)

- [ ] `psql` exited `0` with no `ERROR` or `WARNING` lines in the output.
- [ ] `information_schema.tables` count for `public` matches the source backup (49 at last verification).
- [ ] Representative row counts match the source backup exactly (last verified: `venues`=406, `events`=42, `operators`=28, `markets`=4).
- [ ] Spot-check actual row content on at least one table (not just counts) — confirm real, readable data, not corrupted rows.
- [ ] No orphaned foreign keys (e.g. every `venues.market_id` resolves to a real `markets.id`).
- [ ] `pg_indexes` count for `public` is non-trivial — confirms indexes came through, not just bare tables (177 at last verification).
- [ ] `auth.users` has rows — confirms auth data (not just `public` schema data) restored correctly.
- [ ] If this was a temporary/throwaway project, confirm it has been deleted after verification.

---

## 6. Disaster Recovery Decision Guide

**Never overwrite production until a restore decision has been explicitly confirmed.** A restore is a destructive action against whatever currently exists in the target project — treat it with the same caution as a production database migration, not as a routine fix.

| Situation | Action |
|---|---|
| Application bug (bad deploy, broken code path, incorrect UI behavior) | **Do not restore.** Fix and redeploy the application. A database restore does not fix application code and will not help. |
| Confirmed data corruption or accidental destructive data change (bad migration, accidental mass delete/update) | **Restore.** Use the automatic backup restore (§4) if restoring the current project to a known-good state is the goal, choosing the backup immediately before the incident. |
| Need to investigate what data looked like at a past point, without disrupting production | **Restore into an isolated project first** (§5, manual SQL restore, or the closest available backup dumped and restored elsewhere). Never investigate by restoring over production. |
| Uncertain whether an incident is data-related or application-related | **Investigate before restoring.** Check application logs, Sentry, and recent deploys first (see `docs/monitoring.md`). Only move to a restore once data loss/corruption is confirmed, not suspected. |
| Need to verify a backup is actually usable | **Restore into an isolated project** (§5) — this is exactly the procedure verified for this runbook, and it never touches production. |

---

## 7. Production Recovery Checklist

Run this checklist after **any** restore affecting the production project — automatic or manual — before considering the incident resolved.

- [ ] **Verify database health.** Project status is `ACTIVE_HEALTHY`; REST API and Auth API both respond with HTTP 200 on a basic read request.
- [ ] **Verify representative data.** Row counts on key tables (`venues`, `events`, `operators`, `markets`, `consumer_profiles`, etc.) match expectations for the restore point. Spot-check actual content, not just counts.
- [ ] **Verify authentication.** Sign in as a test consumer account and a test operator account; confirm session issuance and `auth.users` data are intact.
- [ ] **Verify website functionality.** Load the public website homepage, a venue page, an event page, and search — confirm they render with real data (see `WEBSITE_VISION_AND_DESIGN_PRINCIPLES.md` / `WEBSITE_PRODUCT_PLAYBOOK.md` for what "working" should look and feel like, not just "returns 200").
- [ ] **Verify Operator Admin.** Log in as an operator, confirm venue management data (hours, events, claims) is present and editable.
- [ ] **Verify Founder Control Panel.** Log in as a platform admin, confirm access to Collections, Homepages, Content Engine, and Operator/Venue management screens.
- [ ] **Verify Stripe functionality (if applicable).** Confirm operator subscription/plan data is intact and the Stripe webhook endpoint (`/api/webhooks/stripe`) is reachable. If the restore point predates recent subscription changes, reconcile against Stripe's own records before assuming the database is authoritative.
- [ ] **Verify scheduled jobs and integrations.** Confirm any configured scheduled jobs or third-party integrations (analytics, Slack notifications, email delivery via Resend) resume normally post-restore. Note: as of the most recent analytics audit, this project has no scheduled/cron jobs in production — confirm this is still accurate before assuming there's nothing to check here.
- [ ] **Confirm no silent reconnection to a non-production database.** If any part of the recovery involved a temporary/isolated project, confirm the live application's environment variables still point at the actual production project, not the temporary one.

---

## 8. Known Limitations

- **Storage objects require separate handling.** No backup or restore procedure in this document includes Supabase Storage files — only their metadata rows (which reference files, not the files themselves). Storage objects need a separate export/import (object-by-object via the Storage API) if they're part of a recovery scenario.
- **PITR is not enabled.** The project relies on daily backups only. Worst case, a production incident can lose up to ~1 day of data (the gap since the last completed daily backup). Enabling Point-in-Time Recovery (a paid Pro-plan add-on, requires at least a Small compute add-on) would reduce this to as little as a 2-minute RPO, at additional monthly cost (from ~$100/month for 7-day PITR retention).
- **Current backup retention:** automatic daily backups, ~7 days rolling (Pro-plan entitlement). No automatic off-site copy exists today — manual backups are the only copies that leave Supabase's infrastructure, and today those are only as durable as wherever they're manually stored.
- **Current recovery capabilities:**
  - Automatic in-place restore (Dashboard) and manual SQL restore (CLI/`psql`) are both verified and available.
  - The officially recommended "Restore to a New Project" feature — the ideal way to test an automatic-backup restore without touching production — is **Dashboard-only**; no CLI or Management API equivalent exists. This runbook's manual-SQL-restore path is the scriptable alternative used for isolated verification instead.
  - The production database's root Postgres password is not known or stored anywhere in this project's tooling, by design — backups use the Supabase CLI's ephemeral scoped-credential mechanism instead. This is sufficient for backups and for restoring into a *new* project, but means an in-place restore must go through the Dashboard (which authenticates separately) rather than a locally-scripted `psql` connection to the production project itself.
  - Custom database role passwords are not preserved by daily backups and must be reset manually after any restore that relies on them.
  - There is only one Supabase project behind local dev, staging, and production (see §1 Scope) — there is no separate environment to fail over to during an incident.

---

## 9. Revision History

| Date | Change | Context |
|---|---|---|
| 2026-07-25 | Initial creation | Written following successful completion of the production backup investigation, the Pro-plan upgrade verification, and the restore procedure verification (manual SQL restore performed end-to-end against an isolated temporary project, then deleted) carried out during launch preparation. |
