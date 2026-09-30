import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseVenueIdentifier,
  recordVenueClick,
  type VenueClickDeps,
  type VenueIdentifier,
} from "../../../src/lib/venueClickTracking";

/**
 * /api/track/venue-click — Operator Admin Intent capture. Exercised through
 * recordVenueClick() with in-memory fakes; no test touches a real database.
 */

const VENUE_UUID = "3f2b8c1e-5d4a-4e6f-9a1b-2c3d4e5f6a7b";
const VENUE_SLUG = "kettle-river-brewing-co";
const SESSION = "0b8f1a52-9c1d-4c4e-8d2a-7e6f5a4b3c2d";

type Row = { venue_id: string; click_type: string; session_id: string };

function fakeDeps(overrides: Partial<VenueClickDeps> = {}) {
  const inserted: Row[] = [];
  const lookups: VenueIdentifier[] = [];
  const logs: string[] = [];
  const deps: VenueClickDeps = {
    findVenueId: async (identifier) => {
      lookups.push(identifier);
      if (identifier.kind === "uuid" && identifier.value === VENUE_UUID) return { venueId: VENUE_UUID, error: null };
      if (identifier.kind === "slug" && identifier.value === VENUE_SLUG) return { venueId: VENUE_UUID, error: null };
      return { venueId: null, error: null };
    },
    insertClick: async (row) => {
      inserted.push(row);
      return { error: null };
    },
    logError: (message) => {
      logs.push(message);
    },
    ...overrides,
  };
  return { deps, inserted, lookups, logs };
}

test("UUID caller inserts under that venue UUID", async () => {
  const { deps, inserted } = fakeDeps();
  const result = await recordVenueClick({ venueId: VENUE_UUID, clickType: "website", sessionId: SESSION }, deps);
  assert.deepEqual(result, { status: 204 });
  assert.deepEqual(inserted, [{ venue_id: VENUE_UUID, click_type: "website", session_id: SESSION }]);
});

test("upper-case UUID is normalised before lookup", async () => {
  const { deps, inserted, lookups } = fakeDeps();
  await recordVenueClick({ venueId: VENUE_UUID.toUpperCase(), clickType: "menu", sessionId: SESSION }, deps);
  assert.deepEqual(lookups, [{ kind: "uuid", value: VENUE_UUID }]);
  assert.equal(inserted[0].venue_id, VENUE_UUID);
});

test("slug caller resolves and inserts under the venue UUID, never the slug", async () => {
  for (const clickType of ["website", "menu", "hh_schedule_expand", "business_hours_expand"]) {
    const { deps, inserted, lookups } = fakeDeps();
    const result = await recordVenueClick({ venueId: VENUE_SLUG, clickType, sessionId: SESSION }, deps);
    assert.equal(result.status, 204, clickType);
    assert.deepEqual(lookups, [{ kind: "slug", value: VENUE_SLUG }]);
    assert.deepEqual(inserted, [{ venue_id: VENUE_UUID, click_type: clickType, session_id: SESSION }]);
  }
});

test("unknown venue (UUID or slug) returns 404 and does not insert", async () => {
  for (const venueId of ["00000000-0000-4000-8000-000000000000", "no-such-venue"]) {
    const { deps, inserted } = fakeDeps();
    const result = await recordVenueClick({ venueId, clickType: "website", sessionId: SESSION }, deps);
    assert.equal(result.status, 404, venueId);
    assert.equal(inserted.length, 0);
  }
});

test("malformed identifiers are rejected before any lookup", async () => {
  const bad: unknown[] = [
    undefined, null, 42, "", "Kettle River", "kettle_river", "-leading", "trailing-", "double--dash",
    "UPPER-slug", "slug'; drop table venues;--", "a".repeat(201), { id: VENUE_UUID },
  ];
  for (const venueId of bad) {
    const { deps, inserted, lookups } = fakeDeps();
    const result = await recordVenueClick({ venueId, clickType: "website", sessionId: SESSION }, deps);
    assert.equal(result.status, 400, String(venueId));
    assert.equal(lookups.length, 0);
    assert.equal(inserted.length, 0);
  }
  assert.equal(parseVenueIdentifier("a".repeat(200))?.kind, "slug");
});

test("unsupported click types and missing session are rejected without inserting", async () => {
  for (const payload of [
    { venueId: VENUE_UUID, clickType: "phone", sessionId: SESSION },
    { venueId: VENUE_UUID, clickType: "WEBSITE", sessionId: SESSION },
    { venueId: VENUE_UUID, sessionId: SESSION },
    { venueId: VENUE_UUID, clickType: "website", sessionId: "" },
    { venueId: VENUE_UUID, clickType: "website" },
  ]) {
    const { deps, inserted, lookups } = fakeDeps();
    const result = await recordVenueClick(payload, deps);
    assert.equal(result.status, 400, JSON.stringify(payload));
    assert.equal(lookups.length, 0);
    assert.equal(inserted.length, 0);
  }
  for (const body of [null, "string", 7]) {
    const { deps } = fakeDeps();
    assert.equal((await recordVenueClick(body, deps)).status, 400);
  }
});

test("lookup failure returns 500 (not success), logs, and does not insert", async () => {
  for (const findVenueId of [
    async () => ({ venueId: null, error: { message: "boom" } }),
    async () => { throw new Error("network"); },
  ] as VenueClickDeps["findVenueId"][]) {
    const { deps, inserted, logs } = fakeDeps({ findVenueId });
    const result = await recordVenueClick({ venueId: VENUE_SLUG, clickType: "menu", sessionId: SESSION }, deps);
    assert.equal(result.status, 500);
    assert.equal(inserted.length, 0);
    assert.equal(logs.length, 1);
  }
});

test("insert failure returns 500 (not success) and logs", async () => {
  for (const insertClick of [
    async () => ({ error: { code: "23503", message: "fk violation" } }),
    async () => { throw new Error("network"); },
  ] as VenueClickDeps["insertClick"][]) {
    const { deps, logs } = fakeDeps({ insertClick });
    const result = await recordVenueClick({ venueId: VENUE_UUID, clickType: "hh_schedule_expand", sessionId: SESSION }, deps);
    assert.equal(result.status, 500);
    assert.equal(logs.length, 1);
  }
});

test("route wiring: parameterized lookup by id/slug, real insert error surfaced, no plan gating", () => {
  const route = readFileSync(join(__dirname, "../../../src/app/api/track/venue-click/route.ts"), "utf8");
  assert.match(route, /\.from\("venues"\)\s*\.select\("id"\)\s*\.eq\(identifier\.kind === "uuid" \? "id" : "slug", identifier\.value\)\s*\.maybeSingle\(\)/);
  assert.match(route, /const \{ error \} = await supabase\.from\("venue_click_events"\)\.insert\(row\);\s*return \{ error \};/);
  assert.match(route, /status: result\.status/);
  assert.doesNotMatch(route, /plan|subscription/i);
});
