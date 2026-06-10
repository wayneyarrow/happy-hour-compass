# Happy Hour Compass — Project Rules for Claude Code

## Supabase migrations

### Every new public-schema table must have explicit GRANTs

Supabase removes automatic grants for `anon`, `authenticated`, and `service_role` on new public-schema tables starting **October 30 2026**. Any table created without explicit GRANTs will be silently inaccessible via the Supabase Data API.

**Rule:** Every migration that creates a `CREATE TABLE` in the `public` schema must end with a GRANT block.

**Template:** Copy `supabase/migrations/_template.sql` — the GRANT section is pre-filled with the correct structure and inline guidance.

**Reference:** `supabase/migrations/039_security_hardening.sql` documents the full grant philosophy:
- `anon` — public-facing intake forms only (no login gate required)
- `authenticated` — operator-facing tables accessed directly by the app
- `service_role` — all tables, always (bypasses RLS; required for `createAdminClient()`)
- Scope each role to the minimum operations it actually performs (`SELECT`, `INSERT`, `ALL`, etc.)
- Never grant `ALL` to `anon` or `authenticated`

### RLS must be enabled on every new table

Always include `ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;` even if no permissive policies are added yet. No permissive policy + RLS enabled = inaccessible to all non-service-role callers by default (safe baseline).
