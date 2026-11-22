import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readByIds } from "../../../src/lib/data/actionCenter";
import { carryMarketParam } from "../../../src/lib/marketFilter";
import { scopeVenueQuery } from "../../../src/lib/dashboardMarketScope";

/**
 * Action Center market filter (summary + 12 reports, ?market=). Fixtures
 * and source wiring only — no database access.
 */

const SRC = join(__dirname, "../../../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const REPORTS_DIR = "app/control-panel/action-center/reports";
const REPORTS = readdirSync(join(SRC, REPORTS_DIR));

/** Fake admin client: one table of rows, honouring .in() / .eq() / .order() / .range() and head counts. */
function fakeClient(rows: { id: string; venue_id: string; type?: string }[]) {
  const inLists: number[] = [];
  const client = {
    from() {
      let filtered = rows;
      let head = false;
      const q: Record<string, unknown> = {
        select(_c: string, o?: { head?: boolean }) { head = !!o?.head; return q; },
        in(col: string, ids: string[]) { inLists.push(ids.length); filtered = filtered.filter((r) => ids.includes((r as never)[col])); return q; },
        eq(col: string, v: unknown) { filtered = filtered.filter((r) => (r as never)[col] === v); return q; },
        order() { return q; },
        range(a: number, b: number) {
          const sorted = [...filtered].sort((x, y) => x.id.localeCompare(y.id));
          return Promise.resolve({ data: sorted.slice(a, b + 1), error: null });
        },
        then(resolve: (v: unknown) => void) { resolve(head ? { count: filtered.length, error: null } : { data: filtered, error: null }); },
      };
      return q;
    },
  };
  return { client, inLists };
}

test("readByIds: a 437-id lookup is split into URL-safe chunks and returns every matching row once", async () => {
  // 437 venues — the Seeded Venues Needing Claims size whose single .in() request overflowed the URL.
  const venueIds = Array.from({ length: 437 }, (_, i) => `v${String(i).padStart(4, "0")}`);
  const rows = venueIds.flatMap((v, i) =>
    Array.from({ length: i % 3 }, (_, k) => ({ id: `${v}-m${k}`, venue_id: v, type: k === 1 ? "logo" : "venue_image" }))
  );
  const { client, inLists } = fakeClient(rows);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await readByIds(client as any, "media", "id, venue_id", "venue_id", venueIds, (q) => q.eq("type", "venue_image"));
  const expected = rows.filter((x) => x.type === "venue_image");
  assert.equal(r.error, null);
  assert.equal(r.data.length, expected.length);
  assert.deepEqual(new Set(r.data.map((x: { id: string }) => x.id)), new Set(expected.map((x) => x.id)));
  assert.ok(inLists.length > 1, "more than one chunk");
  assert.ok(inLists.every((n) => n <= 150), `every .in() list is ≤150 ids (saw ${Math.max(...inLists)})`);
});

test("readByIds: an empty id list makes no request and returns no rows", async () => {
  const { client, inLists } = fakeClient([{ id: "a", venue_id: "v1" }]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await readByIds(client as any, "media", "id, venue_id", "venue_id", []);
  assert.deepEqual(r, { data: [], error: null });
  assert.equal(inLists.length, 0);
});

test("scopeVenueQuery: identity for All, = id for a market, IS NULL for Unassigned", () => {
  const calls: string[] = [];
  const q = { eq: (c: string, v: string) => (calls.push(`eq ${c} ${v}`), q), is: (c: string, v: null) => (calls.push(`is ${c} ${v}`), q) };
  scopeVenueQuery(q, { kind: "all" });
  scopeVenueQuery(q, { kind: "market", marketId: "m-co" });
  scopeVenueQuery(q, { kind: "unassigned" });
  assert.deepEqual(calls, ["eq market_id m-co", "is market_id null"]);
});

test("carryMarketParam: search/sort/page URL rebuilds keep ?market=", () => {
  const p = new URLSearchParams({ q: "bar", page: "2" });
  assert.equal(carryMarketParam(p, "?market=greater-san-diego&q=old").toString(), "q=bar&page=2&market=greater-san-diego");
  assert.equal(carryMarketParam(new URLSearchParams("q=x"), "?q=old").toString(), "q=x");
});

test("summary: every loader receives the page's scope and every card link carries the selection", () => {
  const page = read("app/control-panel/action-center/page.tsx");
  const body = page.slice(page.indexOf("export default async function ActionCenterPage"));
  assert.ok(body.indexOf("await requireControlPanelAdmin()") < body.indexOf("resolvePageMarketScope("));
  assert.match(page, /getActionCenterSummary\(market\.scope\)/);
  assert.match(page, /getSpecialsAdoptionSummary\(market\.scope\)/);
  assert.match(page, /getPlanGrantReport\(Date\.now\(\), market\.scope\)/);
  assert.match(page, /href=\{`\$\{report\.href\}\$\{market\.query\}`\}/);
  assert.match(page, /<ActionCenterMarketFilter market=\{market\} \/>/);
});

test("summary cards use the same scoped loaders as their reports", () => {
  const src = read("lib/data/actionCenter.ts");
  assert.match(src, /getUnusedSearchTagsOpportunities\(scope\),\s*getUpgradeOpportunities\(scope\),\s*getOperatorActivationReviewSummary\(supabase, new Date\(\), scope\)/);
  assert.match(src, /loadInactiveOperators\(supabase, t30, scope\)\.then\(\(r\) => \(\{ count: r\.operators\.length \}\)\)/);
  assert.match(src, /const \{ operators, venues \} = await loadInactiveOperators\(supabase, t30, scope\);/);
  assert.match(src, /getVenueViewCounts\(t30, scopedVenueIds\)/);
  assert.match(src, /getVenueViewCounts\(t30, await venueIdsInScope\(supabase, scope\)\)/);
  assert.match(src, /getEventViewCounts\(t30, await eventIdsInScope\(supabase, scope\)\)/);
});

test("every report page: admin check first, scope resolved from ?market=, passed to its loader, back link keeps it", () => {
  assert.equal(REPORTS.length, 12);
  for (const dir of REPORTS) {
    const page = read(`${REPORTS_DIR}/${dir}/page.tsx`);
    const body = page.slice(page.indexOf("export default async function"));
    assert.ok(body.indexOf("await requireControlPanelAdmin()") < body.indexOf("resolvePageMarketScope("), dir);
    assert.match(page, /market\.scope\)/, `${dir} passes market.scope to its loader`);
    assert.match(page, /href=\{`\/control-panel\/action-center\$\{market\.query\}`\}/, `${dir} back link`);
    assert.match(page, /<ActionCenterMarketFilter market=\{market\} \/>/, dir);
  }
});

test("every report table that writes URL state keeps ?market=", () => {
  for (const dir of REPORTS) {
    const p = join(SRC, REPORTS_DIR, dir, "ReportTable.tsx");
    if (!existsSync(p)) continue;
    const src = readFileSync(p, "utf8");
    if (!src.includes("replaceState")) continue;
    assert.match(src, /const p = carryMarketParam\(new URLSearchParams\(\), window\.location\.search\);/, dir);
  }
});

test("activation reviews follow the origin's venue market; no venue → Unassigned", () => {
  const src = read("lib/activation/activationReviews.ts");
  assert.match(src, /inDashboardScope\(r\.venueMarketId, scope\)/);
  assert.match(src, /venueMarketId: venue\?\.market_id \?\? null/);
  assert.match(src, /select\("id, name, phone, created_by_operator_id, market_id"\)/);
});

test("no unpaginated venue base queries remain in the Action Center reports", () => {
  const src = read("lib/data/actionCenter.ts");
  // The only direct venues reads left are exact head counts (count is server-side, not row-capped).
  const direct = src.match(/supabase\.from\("venues"\)\.select\([^)]*\)/g) ?? [];
  assert.ok(direct.every((m) => m.includes('{ count: "exact", head: true }')), direct.join("\n"));
});
