import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertTrackingRow, isMissingMigration110Error } from "../../../src/lib/trackingInsert";

type Call = { op: "insert" | "upsert"; table: string; rows: unknown; onConflict?: string };

/** Fake client: returns the queued error (or none) for each successive write. */
function fakeClient(errors: Array<{ code: string; message: string } | null>) {
  const calls: Call[] = [];
  const next = () => ({ error: errors.shift() ?? null });
  const client = {
    from: (table: string) => ({
      insert: async (rows: unknown) => (calls.push({ op: "insert", table, rows }), next()),
      upsert: async (rows: unknown, o: { onConflict: string }) => (calls.push({ op: "upsert", table, rows, onConflict: o.onConflict }), next()),
    }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

const ROW = { venue_id: "v", session_id: "s", city: null, environment: "staging" };

test("success: one write, no fallback, nothing logged", async () => {
  const { client, calls } = fakeClient([null]);
  const logs: string[] = [];
  const out = await insertTrackingRow(client, "venue_view_events", ROW, ["environment"], { log: (m) => logs.push(m) });
  assert.equal(out, "inserted");
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, []);
});

test("migration 110 not applied (unknown column): retries once with the pre-110 row — the venue view survives", async () => {
  const { client, calls } = fakeClient([{ code: "PGRST204", message: "Could not find the 'environment' column" }, null]);
  const logs: string[] = [];
  const out = await insertTrackingRow(client, "venue_view_events", ROW, ["environment"], { log: (m) => logs.push(m) });
  assert.equal(out, "fallback_inserted");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].rows, { venue_id: "v", session_id: "s", city: null });
  assert.equal(logs.length, 1); // the fallback itself is visible in logs
});

test("ON CONFLICT target missing (search_id index not created yet) also falls back to a plain pre-110 insert", async () => {
  const { client, calls } = fakeClient([{ code: "42P10", message: "no unique or exclusion constraint" }, null]);
  const out = await insertTrackingRow(
    client, "website_search_events", { search_term: "wine", search_id: "x", mode: "events" }, ["search_id", "mode"],
    { onConflict: "search_id", log: () => {} }
  );
  assert.equal(out, "fallback_inserted");
  assert.equal(calls[0].op, "upsert");
  assert.deepEqual(calls[1], { op: "insert", table: "website_search_events", rows: { search_term: "wine" } });
});

test("unrelated errors (FK, CHECK, permission) are logged and NOT retried", async () => {
  for (const code of ["23503", "23514", "42501", "PGRST301"]) {
    const { client, calls } = fakeClient([{ code, message: "boom" }]);
    const logs: Array<Record<string, unknown>> = [];
    const out = await insertTrackingRow(client, "venue_view_events", ROW, ["environment"], { log: (_m, d) => logs.push(d) });
    assert.equal(out, "failed", code);
    assert.equal(calls.length, 1, code);
    assert.equal(logs[0].code, code);
  }
});

test("a failing fallback is logged too", async () => {
  const { client } = fakeClient([{ code: "42703", message: "undefined column" }, { code: "23503", message: "fk" }]);
  const logs: string[] = [];
  const out = await insertTrackingRow(client, "venue_view_events", ROW, ["environment"], { log: (m) => logs.push(m) });
  assert.equal(out, "failed");
  assert.equal(logs.length, 2);
});

test("batch rows are stripped row by row", async () => {
  const { client, calls } = fakeClient([{ code: "PGRST204", message: "x" }, null]);
  await insertTrackingRow(client, "venue_discover_events", [{ a: 1, environment: "p" }, { a: 2, environment: "p" }], ["environment"], { log: () => {} });
  assert.deepEqual(calls[1].rows, [{ a: 1 }, { a: 2 }]);
});

test("only the three schema-missing codes are treated as 'migration not applied'", () => {
  assert.equal(isMissingMigration110Error({ code: "PGRST204" }), true);
  assert.equal(isMissingMigration110Error({ code: "42703" }), true);
  assert.equal(isMissingMigration110Error({ code: "42P10" }), true);
  assert.equal(isMissingMigration110Error({ code: "23505" }), false);
  assert.equal(isMissingMigration110Error(null), false);
});
