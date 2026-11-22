import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchAllRows, PAGE_SIZE } from "../../../src/lib/supabase/fetchAllRows";
import * as reportModule from "../../../src/lib/data/searchDiscoveryReport";
import * as sharedModule from "../../../src/lib/supabase/fetchAllRows";

/**
 * The Control Panel Venues page reads the complete venues dataset (past
 * PostgREST's 1,000-row cap) with a deterministic order, so every record is
 * fetched exactly once across page boundaries before browser-side filtering.
 */

type Row = { id: string; updated_at: string };

/**
 * A fake admin client over a fixed table that honours .order() and .range()
 * like PostgREST: rows sorted by the requested columns, then sliced. Rows
 * share updated_at values, so ordering by updated_at alone would be
 * ambiguous across pages — the fixture's storage order is shuffled to make
 * an ambiguous order visible.
 */
function fakeAdmin(table: Row[]) {
  const orders: string[][] = [];
  const ranges: [number, number][] = [];
  const client = {
    from() {
      const order: string[] = [];
      let head = false;
      const q: Record<string, unknown> = {
        select(_c: string, o?: { head?: boolean }) { head = !!o?.head; return q; },
        order(col: string) { order.push(col); return q; },
        range(a: number, b: number) {
          orders.push([...order]);
          ranges.push([a, b]);
          const sorted = [...table].sort((x, y) => {
            for (const c of order) {
              const cmp = String(x[c as keyof Row]).localeCompare(String(y[c as keyof Row]));
              if (cmp) return cmp;
            }
            return 0;
          });
          return Promise.resolve({ data: sorted.slice(a, b + 1), error: null });
        },
        then(resolve: (v: unknown) => void) {
          resolve(head ? { count: table.length, error: null } : { data: table, error: null });
        },
      };
      return q;
    },
  };
  return { client, orders, ranges };
}

function shuffled<T>(xs: T[]): T[] {
  const out = [...xs];
  let seed = 7;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

test("a fixture spanning three fetch pages is read completely, each record exactly once", async () => {
  const total = PAGE_SIZE * 2 + 345;
  const table: Row[] = shuffled(
    Array.from({ length: total }, (_, i) => ({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      updated_at: `2026-11-${String((i % 5) + 10)}T00:00:00Z`, // heavy ties
    }))
  );
  const { client, orders, ranges } = fakeAdmin(table);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await fetchAllRows<Row>(client as any, "venues", "id, updated_at", (q) => q, ["id"]);

  assert.equal(rows.length, total);
  assert.equal(new Set(rows.map((r) => r.id)).size, total);
  assert.deepEqual(new Set(rows.map((r) => r.id)), new Set(table.map((r) => r.id)));
  assert.equal(ranges.length, 3, "three 1,000-row pages");
  assert.deepEqual(ranges.map(([a]) => a).sort((a, b) => a - b), [0, PAGE_SIZE, PAGE_SIZE * 2]);
  assert.ok(orders.every((o) => o.join(",") === "id"), "every page uses the same unique order");
});

test("the Venues page uses the complete read, ordered by the unique id, with the market FK selected", () => {
  const src = readFileSync(join(__dirname, "../../../src/app/control-panel/venues/page.tsx"), "utf8");
  const guard = src.indexOf("await requireControlPanelAdmin()");
  const read = src.indexOf("fetchAllRows<VenueDbRow>(");
  assert.ok(guard > 0 && read > guard, "admin check runs before the read");
  const call = src.slice(read, src.indexOf(")", src.indexOf('["id"]', read)) + 1);
  assert.match(call, /"venues"/);
  assert.match(call, /market_id/);
  assert.match(call, /\["id"\]/, "deterministic order on the primary key");
  assert.ok(!/\.from\("venues"\)\s*\.select\(/.test(src), "no unpaginated venues select remains");
  assert.match(src, /getControlPanelMarketOptions\(\)/);
});

test("the Search & Discovery report re-exports the same helper and error classes", () => {
  assert.equal(reportModule.fetchAllRows, sharedModule.fetchAllRows);
  assert.equal(reportModule.IncompleteReadError, sharedModule.IncompleteReadError);
  assert.equal(reportModule.ReportTooLargeError, sharedModule.ReportTooLargeError);
  assert.equal(reportModule.PAGE_SIZE, sharedModule.PAGE_SIZE);
  assert.equal(reportModule.MAX_ROWS_PER_READ, sharedModule.MAX_ROWS_PER_READ);
});
