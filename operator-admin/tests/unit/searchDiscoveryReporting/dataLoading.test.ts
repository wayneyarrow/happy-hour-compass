import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchAllRows,
  IncompleteReadError,
  MAX_ROWS_PER_READ,
  PAGE_SIZE,
  ReportTooLargeError,
} from "../../../src/lib/data/searchDiscoveryReport";

/**
 * fetchAllRows() never returns silently truncated data: it reads every page
 * (PostgREST caps responses at 1,000 rows), refuses ranges above the
 * ceiling, and refuses a read that doesn't match the exact count.
 */

function fakeAdmin(total: number, opts: { dropFromPage?: number } = {}) {
  const calls: { head: boolean; range?: [number, number]; filters: string[] }[] = [];
  const client = {
    from() {
      const call = { head: false, filters: [] as string[] } as (typeof calls)[number];
      calls.push(call);
      const q: Record<string, unknown> = {
        select(_cols: string, o?: { head?: boolean }) { call.head = !!o?.head; return q; },
        eq(c: string, v: unknown) { call.filters.push(`eq:${c}=${v}`); return q; },
        not(c: string, op: string, v: unknown) { call.filters.push(`not:${c} ${op} ${v}`); return q; },
        order() { return q; },
        range(a: number, b: number) {
          call.range = [a, b];
          const n = Math.max(0, Math.min(b, total - 1) - a + 1);
          const rows = Array.from({ length: n }, (_, i) => ({ id: a + i }));
          if (opts.dropFromPage !== undefined && a / PAGE_SIZE === opts.dropFromPage) rows.pop();
          return Promise.resolve({ data: rows, error: null });
        },
        then(resolve: (v: unknown) => void) { resolve({ count: total, error: null }); },
      };
      return q;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, calls };
}

const filter = (q: { eq: (c: string, v: string) => unknown }) => q.eq("environment", "production");

test("reads every page beyond the 1,000-row cap and returns exactly the counted rows", async () => {
  const { client, calls } = fakeAdmin(2_345);
  const rows = await fetchAllRows<{ id: number }>(client, "t", "id", filter, ["occurred_at", "id"]);
  assert.equal(rows.length, 2_345);
  assert.deepEqual(rows.map((r) => r.id), Array.from({ length: 2_345 }, (_, i) => i));
  const pages = calls.filter((c) => c.range);
  assert.equal(pages.length, 3);
  // The count and every page carry the same filter.
  for (const c of calls) assert.deepEqual(c.filters, ["eq:environment=production"]);
});

test("refuses a range larger than the ceiling instead of aggregating part of it", async () => {
  const { client, calls } = fakeAdmin(MAX_ROWS_PER_READ + 1);
  await assert.rejects(fetchAllRows(client, "t", "id", filter, ["id"]), ReportTooLargeError);
  assert.equal(calls.filter((c) => c.range).length, 0);
});

test("refuses when the rows read don't match the count (never partial totals)", async () => {
  const { client } = fakeAdmin(2_500, { dropFromPage: 1 });
  await assert.rejects(fetchAllRows(client, "t", "id", filter, ["id"]), IncompleteReadError);
});

test("zero rows: a single count query, no page reads", async () => {
  const { client, calls } = fakeAdmin(0);
  assert.deepEqual(await fetchAllRows(client, "t", "id", filter, ["id"]), []);
  assert.equal(calls.length, 1);
});

// ── Wiring ──────────────────────────────────────────────────────────────────

const SRC = join(__dirname, "../../../src");
const loader = readFileSync(join(SRC, "lib/data/searchDiscoveryReport.ts"), "utf8");

test("every report read of an event table applies the release-QA exclusion", () => {
  // Event-table reads go through notQa() (or the explicit qaSessionNotInFilter() for venue views).
  for (const fn of ["loadSearchRows", "loadDiscoveryRows", "loadLegacyDiscovery", "getCollectionStarts"]) {
    const body = loader.slice(loader.indexOf(`export async function ${fn}`), loader.indexOf("\n}\n", loader.indexOf(`export async function ${fn}`)));
    assert.match(body, /notQa\(/, fn);
  }
  const views = loader.slice(loader.indexOf("export async function countVenueViews"));
  assert.match(views, /qaSessionNotInFilter\(\)/);
  assert.match(views, /COUNTED_VIEW_ENVIRONMENT_FILTER/);
});

test("new-tracking reads filter on one explicit environment; legacy load rows never reach visible-impression metrics", () => {
  const disc = loader.slice(loader.indexOf("export async function loadDiscoveryRows"), loader.indexOf("// ── Name resolution"));
  assert.match(disc, /\.eq\("environment", source\)/);
  assert.match(disc, /"website_discovery_events"/);
  assert.doesNotMatch(disc, /venue_discover_events/);
  // Rail overview: load rows are only COUNTED (head counts), never read row by row.
  const legacy = loader.slice(loader.indexOf("export async function loadLegacyDiscovery"), loader.indexOf("/** Human label for a legacy rail_name. */"));
  assert.match(legacy, /count: "exact", head: true \}\)\.eq\("event_type", "impression"\)/);
  assert.doesNotMatch(legacy, /fetchAllRows[^;]*"impression"/);
  // One rail's load rows may be read for the legacy drill-down only — they are
  // shown as load rows, never fed to the visible-impression aggregations.
  const users = ["SearchTab", "PlacementsTab", "GuidesTab", "VenuesTab"].filter((t) =>
    readFileSync(join(SRC, `app/control-panel/analytics/search-discovery/${t}.tsx`), "utf8").includes("loadLegacyRailLoads")
  );
  assert.deepEqual(users, ["PlacementsTab"]);
  const placements = readFileSync(join(SRC, "app/control-panel/analytics/search-discovery/PlacementsTab.tsx"), "utf8");
  const legacyFn = placements.slice(placements.indexOf("async function LegacyPlacements"));
  assert.match(legacyFn, /loadLegacyRailLoads\(/);
  assert.match(legacyFn, /aggregateLegacyRailDetail\(railLoads/);
  assert.doesNotMatch(placements.slice(0, placements.indexOf("async function LegacyPlacements")), /loadLegacyRailLoads\(/);
});

test("the report lives under the Control Panel (admin-gated layout) and its tabs never import legacy loaders into production paths", () => {
  const page = readFileSync(join(SRC, "app/control-panel/analytics/search-discovery/page.tsx"), "utf8");
  assert.match(page, /control-panel\/layout\.tsx/);
  for (const tab of ["PlacementsTab", "GuidesTab", "VenuesTab"]) {
    const s = readFileSync(join(SRC, `app/control-panel/analytics/search-discovery/${tab}.tsx`), "utf8");
    // Legacy rows are handled only in the dedicated legacy branch.
    assert.match(s, /if \(p\.source === "legacy"\) return Legacy\w+\(/, tab);
  }
});

// ── Read consistency under concurrent changes ───────────────────────────────

/**
 * Mutable fake table: `inserts` lists, per read attempt, how many rows get
 * inserted into the window right after the first page is read (simulating a
 * write landing mid-pagination). Page reads and counts see the live state.
 */
function liveTable(initial: number, insertsPerAttempt: number[], opts: { duplicateFirstRow?: boolean } = {}) {
  let total = initial;
  let attempt = -1;
  let pagesThisAttempt = 0;
  let counts = 0;
  const client = {
    from() {
      let head = false;
      const q: Record<string, unknown> = {
        select(_c: string, o?: { head?: boolean }) { head = !!o?.head; return q; },
        eq() { return q; },
        not() { return q; },
        order() { return q; },
        range(a: number, b: number) {
          const n = Math.max(0, Math.min(b, total - 1) - a + 1);
          const rows = Array.from({ length: n }, (_, i) => ({ id: a + i }));
          if (opts.duplicateFirstRow && a === PAGE_SIZE) rows[0] = { id: 0 };
          pagesThisAttempt++;
          if (pagesThisAttempt === 1) total += insertsPerAttempt[attempt] ?? 0; // insert lands mid-read
          return Promise.resolve({ data: rows, error: null });
        },
        then(resolve: (v: unknown) => void) {
          if (head) {
            counts++;
            // A "before" count starts a new attempt (odd-numbered counts).
            if (counts % 2 === 1) { attempt++; pagesThisAttempt = 0; }
          }
          resolve({ count: total, error: null });
        },
      };
      return q;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, attempts: () => attempt + 1 };
}

test("a row landing mid-read in a page-aligned window (2,000 rows) is caught by the re-count and resolved by one retry", async () => {
  const t = liveTable(2_000, [1, 0]); // insert during attempt 1; stable on attempt 2
  const rows = await fetchAllRows<{ id: number }>(t.client, "t", "id", (q) => q, ["id"]);
  assert.equal(t.attempts(), 2);
  assert.equal(rows.length, 2_001);
  assert.equal(new Set(rows.map((r) => r.id)).size, 2_001);
});

test("persistent change during reads ends in an explicit IncompleteReadError (never partial totals)", async () => {
  const t = liveTable(2_500, [1, 1]);
  await assert.rejects(fetchAllRows(t.client, "t", "id", (q) => q, ["id"]), IncompleteReadError);
  assert.equal(t.attempts(), 2);
});

test("duplicated rows across pages (shifted offsets) are rejected, not double-counted", async () => {
  const t = liveTable(1_500, [0, 0], { duplicateFirstRow: true });
  await assert.rejects(fetchAllRows(t.client, "t", "id", (q) => q, ["id"]), IncompleteReadError);
});
