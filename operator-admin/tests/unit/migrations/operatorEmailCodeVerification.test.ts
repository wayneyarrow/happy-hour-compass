import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VERIFICATION_CODE_LIFETIME_MS,
  VERIFICATION_CODE_MAX_ATTEMPTS,
  VERIFICATION_RESEND_COOLDOWN_MS,
  VERIFICATION_SEND_WINDOW_MS,
  VERIFICATION_MAX_SENDS_PER_WINDOW,
  computeVerificationCodeDigest,
} from "../../../src/lib/activation/emailCodeVerificationPolicy";

/**
 * Static verification of migration 100_operator_email_code_verification_foundation.sql
 * — same no-live-Postgres convention as the other migration tests. The
 * migration is NOT applied and its function bodies have not been executed
 * against any database; these tests pin the reviewed design.
 */

const MIGRATION_PATH = join(
  __dirname,
  "../../../../supabase/migrations/100_operator_email_code_verification_foundation.sql"
);
const CODE_ONLY = readFileSync(MIGRATION_PATH, "utf8").replace(/--.*$/gm, "");

const FUNCTIONS = [
  "issue_operator_verification_code",
  "record_operator_verification_code_failure",
  "consume_operator_verification_code",
] as const;
type FunctionName = (typeof FUNCTIONS)[number];

/** Full CREATE FUNCTION statement (header + body) for one function. */
function functionSource(name: FunctionName): string {
  const match = CODE_ONLY.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`));
  assert.ok(match, `expected CREATE OR REPLACE FUNCTION public.${name}`);
  return match![0];
}
/** Function body between the $$ delimiters. */
const body = (name: FunctionName) => functionSource(name).split("$$")[1];
/** Everything outside function definitions. */
const OUTSIDE_FUNCTIONS = FUNCTIONS.reduce((src, name) => src.replace(functionSource(name), ""), CODE_ONLY);

function tableBlock(): string {
  const match = CODE_ONLY.match(/CREATE TABLE IF NOT EXISTS public\.operator_verification_codes \(([\s\S]*?)\n\);/);
  assert.ok(match, "expected CREATE TABLE for operator_verification_codes");
  return match![1];
}

function assertInOrder(source: string, patterns: RegExp[], label: string) {
  let from = 0;
  for (const pattern of patterns) {
    const idx = source.slice(from).search(pattern);
    assert.ok(idx >= 0, `${label}: expected ${pattern} after position ${from}`);
    from += idx + 1;
  }
}

// ── Lifecycle columns ────────────────────────────────────────────────────────

test("lifecycle verification columns default to legacy (false / NULL)", () => {
  assert.match(CODE_ONLY, /verification_required\s+BOOLEAN\s+NOT NULL DEFAULT false/);
  assert.match(CODE_ONLY, /ADD COLUMN IF NOT EXISTS verification_completed_at TIMESTAMPTZ;/);
});

test("verification_completed_at is only allowed when verification_required is true", () => {
  assert.match(
    CODE_ONLY,
    /operator_activation_lifecycles_verification_shape_check\s*\n\s*CHECK \(verification_completed_at IS NULL OR verification_required\)/
  );
});

test("no DML outside the functions, no backfill, no trigger", () => {
  assert.ok(!/\bINSERT\s+INTO\b/i.test(OUTSIDE_FUNCTIONS));
  assert.ok(!/\bUPDATE\s+public\./i.test(OUTSIDE_FUNCTIONS));
  assert.ok(!/\bDELETE\s+FROM\b/i.test(CODE_ONLY));
  assert.ok(!/CREATE TRIGGER/i.test(CODE_ONLY));
});

test("exactly the three reviewed functions are created", () => {
  const created = [...CODE_ONLY.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(created, [...FUNCTIONS].sort());
});

test("does not alter any existing lifecycle operational column", () => {
  const lifecycleAlters = OUTSIDE_FUNCTIONS.match(/ALTER TABLE public\.operator_activation_lifecycles[\s\S]*?;/g) ?? [];
  assert.ok(lifecycleAlters.length > 0);
  for (const stmt of lifecycleAlters) {
    assert.ok(!/started_at|deadline_at|reminder_|expired_at|released_at|expiry_/.test(stmt), stmt);
  }
  // The only lifecycle write in any function is verification_completed_at.
  for (const name of FUNCTIONS) {
    for (const stmt of body(name).match(/UPDATE public\.operator_activation_lifecycles[\s\S]*?;/g) ?? []) {
      const setClause = stmt.match(/SET([\s\S]*?)WHERE/)![1];
      assert.match(setClause, /^\s*verification_completed_at = v_now\s*$/, `${name}: ${stmt}`);
    }
  }
});

// ── Code table ───────────────────────────────────────────────────────────────

test("code table stores a digest only — no plaintext code, token, link, or password column", () => {
  const block = tableBlock();
  assert.match(block, /code_digest\s+TEXT\s+NOT NULL/);
  const columns = block.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  for (const col of columns) {
    assert.ok(!/^(code|plaintext_code|otp|token|password|link|setup_link|recovery_link)$/.test(col), col);
  }
  assert.match(CODE_ONLY, /CHECK \(code_digest ~ '\^\[0-9a-f\]\{64\}\$'\)/);
});

test("digest CHECK matches the real HMAC-SHA256 output (64 lowercase hex)", () => {
  const digest = computeVerificationCodeDigest({
    code: "004217",
    lifecycleId: "2edffd2e-b1bc-4434-a7e6-d752a35c3fdd",
    secret: "test-only-fixture-secret-0123456789abcdef",
  });
  assert.match(digest, new RegExp("^[0-9a-f]{64}$"));
});

test("code table has the lifecycle FK, expiry, attempts, consumed/superseded, and request IP", () => {
  const block = tableBlock();
  assert.match(block, /lifecycle_id\s+UUID\s+NOT NULL REFERENCES public\.operator_activation_lifecycles\(id\)/);
  assert.match(block, /issued_at\s+TIMESTAMPTZ NOT NULL/);
  assert.match(block, /expires_at\s+TIMESTAMPTZ NOT NULL/);
  assert.match(block, /attempt_count\s+INTEGER\s+NOT NULL DEFAULT 0/);
  assert.match(block, /max_attempts\s+INTEGER\s+NOT NULL DEFAULT 5/);
  assert.match(block, /consumed_at\s+TIMESTAMPTZ,/);
  assert.match(block, /superseded_at\s+TIMESTAMPTZ,/);
  assert.match(block, /request_ip\s+TEXT,/);
  assert.match(CODE_ONLY, /CHECK \(max_attempts > 0 AND attempt_count >= 0 AND attempt_count <= max_attempts\)/);
  assert.match(CODE_ONLY, /CHECK \(consumed_at IS NULL OR superseded_at IS NULL\)/);
  assert.match(CODE_ONLY, /CHECK \(consumed_at IS NULL OR attempt_count < max_attempts\)/);
});

test("at most one current code and at most one consumed code per lifecycle (partial unique indexes)", () => {
  assert.match(
    CODE_ONLY,
    /CREATE UNIQUE INDEX IF NOT EXISTS operator_verification_codes_one_current_per_lifecycle_uidx\s+ON public\.operator_verification_codes \(lifecycle_id\)\s+WHERE consumed_at IS NULL AND superseded_at IS NULL;/
  );
  assert.match(
    CODE_ONLY,
    /CREATE UNIQUE INDEX IF NOT EXISTS operator_verification_codes_one_consumed_per_lifecycle_uidx\s+ON public\.operator_verification_codes \(lifecycle_id\)\s+WHERE consumed_at IS NOT NULL;/
  );
  assert.match(CODE_ONLY, /operator_verification_codes_lifecycle_issued_at_idx\s+ON public\.operator_verification_codes \(lifecycle_id, issued_at DESC\)/);
  assert.ok(!/INDEX[^;]*\(request_ip/.test(CODE_ONLY), "no per-IP index until a per-IP limit is defined");
});

// ── Function security ────────────────────────────────────────────────────────

test("every function is plpgsql SECURITY DEFINER with an empty, explicit search_path", () => {
  for (const name of FUNCTIONS) {
    const src = functionSource(name);
    assert.match(src, /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = ''\s+AS \$\$/, name);
    // With an empty search_path, every table reference must be schema-qualified.
    for (const m of body(name).matchAll(/\b(?:FROM|UPDATE|INTO|JOIN)\s+([a-z_][\w.]*)/gi)) {
      const ref = m[1];
      if (/^v_|^code_id$|^code_expires_at$/.test(ref)) continue; // plpgsql SELECT ... INTO variables
      assert.ok(ref.startsWith("public."), `${name}: unqualified reference ${ref}`);
    }
  }
});

test("EXECUTE revoked from PUBLIC, anon, authenticated; granted only to service_role", () => {
  const signatures: Record<FunctionName, string> = {
    issue_operator_verification_code: "UUID, TEXT, TEXT",
    record_operator_verification_code_failure: "UUID, UUID",
    consume_operator_verification_code: "UUID, UUID",
  };
  for (const name of FUNCTIONS) {
    const sig = signatures[name].replace(/[(),]/g, (c) => `\\${c}`);
    assert.match(CODE_ONLY, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\(${sig}\\)\\s+FROM PUBLIC, anon, authenticated;`), name);
    assert.match(CODE_ONLY, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(${sig}\\)\\s+TO service_role;`), name);
  }
  const executeGrantees = [...CODE_ONLY.matchAll(/GRANT EXECUTE[^;]*TO ([^;]+);/g)].map((m) => m[1].trim());
  assert.deepEqual([...new Set(executeGrantees)], ["service_role"]);
});

test("table: RLS on, no policy, all roles revoked, service_role SELECT only", () => {
  assert.match(CODE_ONLY, /ALTER TABLE public\.operator_verification_codes ENABLE ROW LEVEL SECURITY;/);
  assert.ok(!/CREATE POLICY/i.test(CODE_ONLY));
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert.match(CODE_ONLY, new RegExp(`REVOKE ALL ON public\\.operator_verification_codes FROM ${role};`));
  }
  const tableGrants = [...CODE_ONLY.matchAll(/GRANT ([^;]*?) ON public\.operator_verification_codes TO ([^;]+);/g)];
  assert.deepEqual(tableGrants.map((m) => [m[1].trim(), m[2].trim()]), [["SELECT", "service_role"]]);
});

// ── Atomic issuance ──────────────────────────────────────────────────────────

test("issuance locks the lifecycle row before any check, then checks, supersedes, and inserts in order", () => {
  assertInOrder(
    body("issue_operator_verification_code"),
    [
      /FROM public\.operator_activation_lifecycles l\s+WHERE l\.id = p_lifecycle_id\s+FOR UPDATE;/,
      /v_now := clock_timestamp\(\);/,
      /released_at IS NOT NULL/,
      /verification_required/,
      /verification_completed_at IS NOT NULL/,
      /'cooldown'/,
      /'rate_limited'/,
      /UPDATE public\.operator_verification_codes c\s+SET superseded_at = v_now/,
      /INSERT INTO public\.operator_verification_codes/,
      /outcome := 'issued'/,
    ],
    "issue"
  );
});

test("issuance rejects missing, legacy, completed, expired, released, past-deadline, and activated lifecycles", () => {
  const b = body("issue_operator_verification_code");
  assert.match(b, /IF NOT FOUND THEN\s+outcome := 'lifecycle_not_found'/);
  assert.match(b, /v_lifecycle\.released_at IS NOT NULL\s+OR v_lifecycle\.expired_at IS NOT NULL\s+OR v_lifecycle\.deadline_at <= v_now THEN\s+outcome := 'lifecycle_closed'/);
  assert.match(b, /IF v_activated_at IS NOT NULL THEN\s+outcome := 'already_activated'/);
  assert.match(b, /IF NOT v_lifecycle\.verification_required THEN\s+outcome := 'verification_not_required'/);
  assert.match(b, /IF v_lifecycle\.verification_completed_at IS NOT NULL THEN\s+outcome := 'already_verified'/);
});

test("cooldown and rolling-window limits are enforced inside the locked issuance transaction", () => {
  const b = body("issue_operator_verification_code");
  assert.match(b, /IF v_last_issued_at IS NOT NULL AND v_now < v_last_issued_at \+ interval '60 seconds' THEN\s+outcome := 'cooldown'/);
  assert.match(b, /AND c\.issued_at > v_now - interval '60 minutes';/); // exactly-60-minutes-old is outside
  assert.match(b, /IF v_window_count >= 5 THEN\s+outcome := 'rate_limited'/);
});

test("SQL constants match the TypeScript policy constants", () => {
  const b = body("issue_operator_verification_code");
  assert.equal(VERIFICATION_RESEND_COOLDOWN_MS, 60 * 1000);
  assert.match(b, /interval '60 seconds'/);
  assert.equal(VERIFICATION_SEND_WINDOW_MS, 60 * 60 * 1000);
  assert.match(b, /interval '60 minutes'/);
  assert.equal(VERIFICATION_MAX_SENDS_PER_WINDOW, 5);
  assert.equal(VERIFICATION_CODE_LIFETIME_MS, 10 * 60 * 1000);
  assert.match(b, /v_now \+ interval '10 minutes', 5, p_request_ip/);
  assert.equal(VERIFICATION_CODE_MAX_ATTEMPTS, 5);
});

test("issuance returns no digest, IP, or code — only outcome/code_id/expiry/resend time", () => {
  const header = functionSource("issue_operator_verification_code").split("$$")[0];
  const returns = header.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/)![1];
  const cols = returns.split(",").map((c) => c.trim().split(/\s+/)[0]);
  assert.deepEqual(cols, ["outcome", "code_id", "code_expires_at", "resend_available_at"]);
  assert.match(body("issue_operator_verification_code"), /RETURNING id, expires_at INTO code_id, code_expires_at;/);
});

// ── Verification transitions ─────────────────────────────────────────────────

test("failure recording and consumption both lock the lifecycle first and re-check eligibility", () => {
  for (const name of ["record_operator_verification_code_failure", "consume_operator_verification_code"] as const) {
    assertInOrder(
      body(name),
      [
        /FROM public\.operator_activation_lifecycles l\s+WHERE l\.id = p_lifecycle_id\s+FOR UPDATE;/,
        /outcome := 'lifecycle_closed'/,
        /outcome := 'verification_not_required'/,
        /outcome := 'already_verified'/,
        /WHERE c\.id = p_code_id\s+AND c\.lifecycle_id = p_lifecycle_id\s+FOR UPDATE;/,
        /v_code\.consumed_at IS NOT NULL OR v_code\.superseded_at IS NOT NULL THEN\s+outcome := 'code_not_current'/,
        /IF v_now >= v_code\.expires_at THEN\s+outcome := 'code_expired'/,
        /IF v_code\.attempt_count >= v_code\.max_attempts THEN\s+outcome := 'code_exhausted'/,
      ],
      name
    );
  }
});

test("incorrect-attempt recording is a guarded single increment that never consumes or verifies", () => {
  const b = body("record_operator_verification_code_failure");
  assert.match(
    b,
    /SET attempt_count = c\.attempt_count \+ 1\s+WHERE c\.id = v_code\.id\s+AND c\.consumed_at IS NULL\s+AND c\.superseded_at IS NULL\s+AND c\.attempt_count < c\.max_attempts/
  );
  assert.ok(!/consumed_at\s*=/.test(b));
  assert.ok(!/verification_completed_at\s*=/.test(b));
  assert.match(b, /IF NOT FOUND THEN[\s\S]*?RAISE EXCEPTION/); // never reports an unrecorded guess
});

test("correct-code consumption never modifies attempt_count", () => {
  const b = body("consume_operator_verification_code");
  assert.ok(!/attempt_count\s*=/.test(b), "consume must not assign attempt_count");
});

test("consumption is single-use: guarded consume plus once-only verification_completed_at", () => {
  const b = body("consume_operator_verification_code");
  assert.match(b, /SET consumed_at = v_now\s+WHERE c\.id = v_code\.id\s+AND c\.consumed_at IS NULL\s+AND c\.superseded_at IS NULL;/);
  assert.match(
    b,
    /SET verification_completed_at = v_now\s+WHERE l\.id = p_lifecycle_id\s+AND l\.verification_required\s+AND l\.verification_completed_at IS NULL;\s+IF NOT FOUND THEN[\s\S]*?RAISE EXCEPTION/
  );
});
