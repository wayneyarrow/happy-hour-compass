import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration 109_venue_plan_grants.sql (Comp / Trial
 * Part 1) — text assertions against the file itself, no live Postgres in
 * this suite. (The migration was also executed against a disposable
 * in-memory PostgreSQL engine during implementation — functions, ownership
 * trigger, constraints and role permissions — see the Part 1 report.)
 */

const SQL = readFileSync(join(__dirname, "../../../../supabase/migrations/109_venue_plan_grants.sql"), "utf8");
const CODE = SQL.replace(/--.*$/gm, "");

test("creates both tables with RLS enabled", () => {
  assert.match(CODE, /CREATE TABLE IF NOT EXISTS public\.venue_plan_grants/);
  assert.match(CODE, /CREATE TABLE IF NOT EXISTS public\.venue_plan_grant_events/);
  assert.match(CODE, /ALTER TABLE public\.venue_plan_grants\s+ENABLE ROW LEVEL SECURITY;/);
  assert.match(CODE, /ALTER TABLE public\.venue_plan_grant_events ENABLE ROW LEVEL SECURITY;/);
});

test("grant rules are enforced by constraints: pro/premium, comp/trial, trial needs end, end after start", () => {
  assert.match(CODE, /CHECK \(plan_code IN \('pro', 'premium'\)\)/);
  assert.match(CODE, /CHECK \(grant_type IN \('comp', 'trial'\)\)/);
  assert.match(CODE, /CHECK \(grant_type <> 'trial' OR ends_at IS NOT NULL\)/);
  assert.match(CODE, /CHECK \(ends_at IS NULL OR ends_at > starts_at\)/);
  assert.match(CODE, /CHECK \(\(revoked_at IS NULL\) = \(end_reason IS NULL\)\)/);
});

test("never touches billing tables, Stripe state or plan_change_events", () => {
  // COMMENT ON strings are documentation (they reference billing to explain the separation).
  const statements = CODE.replace(/COMMENT ON [\s\S]*?';\n/g, "");
  assert.doesNotMatch(statements, /venue_subscriptions|operator_subscriptions|plan_change_events|sync_venue_plan_entitlement/);
});

test("explicit REVOKE + service_role SELECT-only grants on both new tables (CLAUDE.md GRANT rule)", () => {
  for (const t of ["venue_plan_grants", "venue_plan_grant_events"]) {
    for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
      assert.match(CODE, new RegExp(`REVOKE ALL ON public\\.${t} FROM ${role};`));
    }
    assert.match(CODE, new RegExp(`GRANT SELECT ON public\\.${t} TO service_role;`));
    assert.doesNotMatch(CODE, new RegExp(`GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ON public\\.${t} TO`));
  }
});

test("write functions are SECURITY DEFINER with an empty search_path, executable by service_role only", () => {
  for (const fn of ["create_venue_plan_grant", "change_venue_plan_grant_end", "revoke_venue_plan_grant"]) {
    const start = CODE.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    assert.ok(start >= 0, fn);
    const header = CODE.slice(start, CODE.indexOf("AS $$", start));
    assert.match(header, /SECURITY DEFINER/);
    assert.match(header, /SET search_path = ''/);
    assert.match(CODE, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*FROM PUBLIC, anon, authenticated;`));
    assert.match(CODE, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s*TO service_role;`));
  }
});

test("every write function locks the venue row first (serializes concurrent founder actions)", () => {
  assert.match(CODE, /SELECT v\.\* INTO v_venue FROM public\.venues v WHERE v\.id = p_venue_id FOR UPDATE;/);
  assert.equal((CODE.match(/PERFORM 1 FROM public\.venues v WHERE v\.id = v_grant\.venue_id FOR UPDATE;/g) ?? []).length, 2);
});

test("change/revoke require the grant to belong to the named venue", () => {
  assert.equal((CODE.match(/IF NOT FOUND OR v_grant\.venue_id IS DISTINCT FROM p_venue_id THEN\s+outcome := 'grant_not_found'/g) ?? []).length, 2);
});

test("table-level overlap guard: BEFORE INSERT/UPDATE trigger, venue row lock, exclusion_violation", () => {
  const start = CODE.indexOf("CREATE OR REPLACE FUNCTION public.venue_plan_grants_prevent_overlap()");
  assert.ok(start >= 0);
  const body = CODE.slice(start, CODE.indexOf("$$;", start));
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /PERFORM 1 FROM public\.venues v WHERE v\.id = NEW\.venue_id FOR UPDATE;/);
  assert.match(body, /USING ERRCODE = '23P01'/);
  assert.match(CODE, /BEFORE INSERT OR UPDATE OF starts_at, ends_at, revoked_at, venue_id ON public\.venue_plan_grants/);
});

test("only claimed, non-cancelled venues; at most one open grant; past start clamped to now", () => {
  assert.match(CODE, /IF v_venue\.created_by_operator_id IS NULL THEN\s+outcome := 'venue_unclaimed'/);
  assert.match(CODE, /IF v_venue\.cancelled_at IS NOT NULL THEN\s+outcome := 'venue_cancelled'/);
  assert.match(CODE, /outcome := 'open_grant_exists'/);
  assert.match(CODE, /v_starts := GREATEST\(COALESCE\(p_starts_at, v_now\), v_now\);/);
});

test("revocation before start is recorded as cancelled_before_start (never activates enforcement)", () => {
  assert.match(CODE, /CASE WHEN v_now <= v_grant\.starts_at THEN 'cancelled_before_start' ELSE 'revoked' END/);
});

test("ownership/cancellation trigger: fires on owner change away from non-null or cancellation, ends only open grants", () => {
  assert.match(CODE, /OLD\.created_by_operator_id IS NOT NULL\s+AND OLD\.created_by_operator_id IS DISTINCT FROM NEW\.created_by_operator_id/);
  assert.match(CODE, /OLD\.claimed_by IS NOT NULL\s+AND OLD\.claimed_by IS DISTINCT FROM NEW\.claimed_by/);
  assert.match(CODE, /OLD\.cancelled_at IS NULL AND NEW\.cancelled_at IS NOT NULL/);
  assert.match(CODE, /AND g\.revoked_at IS NULL\s+AND \(g\.ends_at IS NULL OR g\.ends_at > v_now\)/);
  assert.match(CODE, /AFTER UPDATE OF created_by_operator_id, claimed_by, cancelled_at ON public\.venues/);
});

test("nothing ever clears revoked_at (revocation is terminal)", () => {
  assert.doesNotMatch(CODE, /revoked_at\s*=\s*NULL/i);
});

test("the venue FK is explicitly named so PostgREST embeds can disambiguate it", () => {
  assert.match(CODE, /venue_id\s+UUID\s+NOT NULL\s+CONSTRAINT venue_plan_grants_venue_id_fkey\s+REFERENCES public\.venues\(id\) ON DELETE CASCADE/);
});

test("both trigger-only functions are revoked from every client role, including service_role", () => {
  for (const fn of ["venue_plan_grants_end_on_venue_change", "venue_plan_grants_prevent_overlap"]) {
    assert.match(CODE, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\)\\s*FROM PUBLIC, anon, authenticated, service_role;`));
    assert.doesNotMatch(CODE, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}`));
  }
});
