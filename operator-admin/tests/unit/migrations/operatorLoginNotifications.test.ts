import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Static verification of migration 106_operator_login_notifications.sql —
 * same no-live-Postgres convention as the other migration tests here.
 */

const SOURCE = readFileSync(
  join(__dirname, "../../../../supabase/migrations/106_operator_login_notifications.sql"),
  "utf8"
);
const CODE_ONLY = SOURCE.replace(/--.*$/gm, "");

test("adds venue_notes.event_key with a partial unique index", () => {
  assert.match(CODE_ONLY, /ALTER TABLE public\.venue_notes\s+ADD COLUMN IF NOT EXISTS event_key TEXT;/);
  assert.match(
    CODE_ONLY,
    /CREATE UNIQUE INDEX IF NOT EXISTS venue_notes_event_key_uidx\s+ON public\.venue_notes \(event_key\)\s+WHERE event_key IS NOT NULL;/
  );
});

test("Slack claim table is keyed per person per date", () => {
  assert.match(CODE_ONLY, /CREATE TABLE IF NOT EXISTS public\.operator_login_slack_notifications/);
  assert.match(CODE_ONLY, /PRIMARY KEY \(auth_user_id, login_date\)/);
  assert.match(CODE_ONLY, /login_date\s+DATE\s+NOT NULL/);
  assert.match(CODE_ONLY, /sent_at\s+TIMESTAMPTZ,/);
});

test("RLS enabled, service_role-only grant, no permissive policy, no DML", () => {
  assert.match(CODE_ONLY, /ALTER TABLE public\.operator_login_slack_notifications ENABLE ROW LEVEL SECURITY;/);
  assert.match(CODE_ONLY, /GRANT ALL ON public\.operator_login_slack_notifications TO service_role;/);
  assert.doesNotMatch(CODE_ONLY, /\bTO (anon|authenticated)\b/);
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assert.match(CODE_ONLY, new RegExp(`REVOKE ALL ON public\\.operator_login_slack_notifications FROM ${role};`));
  }
  assert.doesNotMatch(CODE_ONLY, /CREATE POLICY/i);
  assert.doesNotMatch(CODE_ONLY, /^\s*(INSERT|UPDATE|DELETE)\b/im);
});
