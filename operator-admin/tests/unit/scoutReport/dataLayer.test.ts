import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  countNotCountedViewRows,
  firstRowAt,
  loadDailySpecialClickRows,
  loadEventViewRows,
  loadIntentRows,
  loadSaveRows,
  loadVenueViewRows,
} from "../../../src/lib/scoutReport/usageData";
import { getEventViewCountsStrict, getVenueViewCountsStrict, TruncatedResultError } from "../../../src/lib/scoutReport/strictViewCounts";
import { getVenueViewCounts } from "../../../src/lib/data/viewCounts";
import { COUNTED_VIEW_ENVIRONMENT_FILTER } from "../../../src/lib/analyticsEnvironment";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const W = { startUtc: "2026-10-12T07:00:00.000Z", endUtc: "2026-10-19T07:00:00.000Z" };

/** Records every builder call per query; answers counts and pages from `rows`. */
function recorder(rows: Record<string, unknown>[] = [], opts: { error?: string } = {}) {
  const queries: { table: string; ops: string[] }[] = [];
  const client = {
    from(table: string) {
      const q = { table, ops: [] as string[], head: false, range: null as null | [number, number] };
      queries.push(q);
      const self: Any = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") {
              return (resolve: (v: unknown) => void) =>
                resolve(opts.error ? { error: { message: opts.error }, count: null, data: null } : q.range ? { data: rows.slice(q.range[0], q.range[1] + 1), error: null } : { count: rows.length, error: null, data: rows });
            }
            if (prop === "maybeSingle") return () => Promise.resolve(opts.error ? { data: null, error: { message: opts.error } } : { data: rows[0] ?? null, error: null });
            return (...args: unknown[]) => {
              if (prop === "select") q.head = !!(args[1] as Any)?.head;
              if (prop === "range") q.range = [args[0] as number, args[1] as number];
              if (!["select", "range", "order", "limit"].includes(prop)) q.ops.push(`${prop}(${args.map((a) => JSON.stringify(a)).join(",")})`);
              return self;
            };
          },
        }
      );
      return self;
    },
  };
  return { client: client as Any, queries };
}

const RANGE = (col: string) => [`gte("${col}","${W.startUtc}")`, `lt("${col}","${W.endUtc}")`];

test("venue and event views keep the established environment predicate and add only the half-open window", async () => {
  for (const [fn, table] of [[loadVenueViewRows, "venue_view_events"], [loadEventViewRows, "event_view_events"]] as const) {
    const { client, queries } = recorder([{ id: "1" }]);
    await fn(client, W);
    assert.ok(queries.length >= 2, "count + page");
    for (const q of queries) {
      assert.equal(q.table, table);
      assert.deepEqual(q.ops, [`or("${COUNTED_VIEW_ENVIRONMENT_FILTER}")`, ...RANGE("viewed_at")]);
    }
  }
});

test("Daily Specials clicks, intent and saves keep their established predicates (no environment filter)", async () => {
  const cases = [
    [loadDailySpecialClickRows, "daily_special_click_events", RANGE("clicked_at")],
    [loadIntentRows, "venue_click_events", RANGE("clicked_at")],
    [loadSaveRows, "venue_save_events", [`eq("action","save")`, ...RANGE("saved_at")]],
  ] as const;
  for (const [fn, table, ops] of cases) {
    const { client, queries } = recorder([{ id: "1" }]);
    await fn(client, W);
    for (const q of queries) {
      assert.equal(q.table, table);
      assert.deepEqual(q.ops, [...ops]);
    }
  }
});

test("the existing readers still use the predicates the Scout loaders mirror", () => {
  const src = readFileSync(join(__dirname, "../../../src/lib/data/operatorAnalyticsV2.ts"), "utf8");
  // Views: COUNTED_VIEW_ENVIRONMENT_FILTER on venue and event views.
  assert.match(src, /from\("venue_view_events"\)[\s\S]{0,200}\.or\(COUNTED_VIEW_ENVIRONMENT_FILTER\)[\s\S]{0,60}\.gte\("viewed_at", since\)/);
  assert.match(src, /from\("event_view_events"\)[\s\S]{0,200}\.or\(COUNTED_VIEW_ENVIRONMENT_FILTER\)[\s\S]{0,60}\.gte\("viewed_at", since\)/);
  // Saves: action = 'save'. Intent: click_type, no environment filter.
  assert.match(src, /from\("venue_save_events"\)[\s\S]{0,160}\.eq\("action", "save"\)/);
  for (const t of ["website", "menu", "hh_schedule_expand", "business_hours_expand"]) {
    assert.match(src, new RegExp(`from\\("venue_click_events"\\)[\\s\\S]{0,160}\\.eq\\("click_type", "${t}"\\)\\s*\\.gte\\("clicked_at", since\\)`));
  }
  const ds = readFileSync(join(__dirname, "../../../src/lib/data/dailySpecialClicks.ts"), "utf8");
  assert.doesNotMatch(ds, /environment/, "Daily Special click summary applies no environment filter");
});

test("non-counted view rows: exactly the rows the established rule excludes", async () => {
  const { client, queries } = recorder([{ id: "1" }, { id: "2" }]);
  assert.equal(await countNotCountedViewRows(client, "venue_view_events", W), 2);
  assert.deepEqual(queries[0].ops, [`not("environment","is",null)`, `neq("environment","production")`, ...RANGE("viewed_at")]);
});

test("first-row lookups and loaders throw on a database error instead of returning empty", async () => {
  await assert.rejects(firstRowAt(recorder([], { error: "boom" }).client, "venue_view_events", "viewed_at"), /boom/);
  await assert.rejects(loadVenueViewRows(recorder([], { error: "boom" }).client, W), /boom/);
  assert.equal(await firstRowAt(recorder([]).client, "venue_view_events", "viewed_at"), null);
});

// ── Strict view counts vs the existing reader ───────────────────────────────

function rpcClient(result: { data?: unknown; error?: { message: string } | null; count?: number | null }) {
  const calls: { fn: string; args: unknown; opts: unknown }[] = [];
  return {
    calls,
    client: { rpc: async (fn: string, args: unknown, opts?: unknown) => (calls.push({ fn, args, opts }), { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null }) } as Any,
  };
}

test("strict all-time counts call the same RPC with the same arguments and give the same map as getVenueViewCounts", async () => {
  const data = [{ venue_id: "a", views: "120" }, { venue_id: "b", views: 30 }];
  const strict = rpcClient({ data, count: 2 });
  const existing = rpcClient({ data, count: 2 });
  const s = await getVenueViewCountsStrict(strict.client, null, ["a", "b"]);
  const e = await getVenueViewCounts(null, ["a", "b"], existing.client);
  assert.deepEqual([...s], [...e]);
  assert.deepEqual(strict.calls[0].args, existing.calls[0].args);
  assert.equal(strict.calls[0].fn, existing.calls[0].fn);
  assert.deepEqual(strict.calls[0].opts, { count: "exact" });
  assert.equal(existing.calls[0].opts, undefined, "the existing reader's call is untouched");
});

test("on failure the existing reader still returns an empty map (unchanged), the strict one throws", async () => {
  const err = { error: { message: "permission denied" } };
  assert.equal((await getVenueViewCounts(null, undefined, rpcClient(err).client)).size, 0);
  await assert.rejects(getVenueViewCountsStrict(rpcClient(err).client, null), /permission denied/);
  await assert.rejects(getEventViewCountsStrict(rpcClient(err).client, null), /permission denied/);
});

test("strict counts detect truncation by the response row limit", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ venue_id: `v${i}`, views: 1 }));
  await assert.rejects(getVenueViewCountsStrict(rpcClient({ data: rows, count: 1400 }).client, null), TruncatedResultError);
  await assert.rejects(getVenueViewCountsStrict(rpcClient({ data: rows, count: null }).client, null), TruncatedResultError);
  assert.equal((await getVenueViewCountsStrict(rpcClient({ data: rows, count: 1000 }).client, null)).size, 1000);
  assert.equal((await getVenueViewCountsStrict(rpcClient({ data: [] }).client, null, [])).size, 0);
});

// ── Wiring: read-only, no communications, authorized download ───────────────

const SRC = join(__dirname, "../../../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
const SCOUT_FILES = ["buildScoutReport.ts", "usageData.ts", "strictViewCounts.ts", "milestones.ts", "windows.ts", "comparison.ts", "redaction.ts", "definitions.ts", "issues.ts", "downloadMessage.ts"].map((f) => `lib/scoutReport/${f}`);

test("the Scout report code never writes, sends or runs detection/delivery", () => {
  for (const f of [...SCOUT_FILES, "app/control-panel/analytics/scout-report/route.ts"]) {
    const src = strip(read(f));
    for (const bad of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /sendTransactionalEmail/, /sendSlack/, /resend/i, /applyVenueViewMilestoneDecisions/, /runVenueViewMilestoneDetection/, /processCustomerSuccessDeliveries/, /processActivationReminders/, /fetch\(/]) {
      assert.doesNotMatch(src, bad, `${f} must not use ${bad}`);
    }
    for (const m of src.matchAll(/\.rpc\(\s*(\w+|"[^"]+")/g)) assert.equal(m[1], "fn", `${f}: unexpected rpc ${m[1]}`);
  }
  const strict = strip(read("lib/scoutReport/strictViewCounts.ts"));
  assert.match(strict, /"venue_view_counts" \| "event_view_counts"/, "only the two view-count RPCs");
  // The milestone reader used is the documented read-only half.
  const b = strip(read("lib/scoutReport/buildScoutReport.ts"));
  assert.match(b, /import \{ computeVenueViewMilestoneDecisions, type VenueViewMilestonePlan \} from "@\/lib\/customerSuccess\/detectVenueViewMilestones"/);
  assert.doesNotMatch(b, /recipient_email/, "recipient addresses are never selected");
});

test("the download route authorizes first, takes no input, and is never cached", () => {
  const src = read("app/control-panel/analytics/scout-report/route.ts");
  const body = strip(src.slice(src.indexOf("export async function GET")));
  assert.match(body, /^export async function GET\(\) \{\s*await requireControlPanelAdmin\(\);/, "admin check is the first statement; no request parameter");
  assert.match(src, /import \{ requireControlPanelAdmin \} from "@\/lib\/requireControlPanelAdmin";/);
  assert.match(src, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.match(src, /export const dynamic = "force-dynamic";/);
  assert.doesNotMatch(src, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(src, /searchParams/);
});

test("existing counting modules are not modified by the Scout report (no Scout imports there)", () => {
  for (const f of ["lib/data/viewCounts.ts", "lib/data/operatorAnalyticsV2.ts", "lib/data/dailySpecialClicks.ts", "lib/data/searchDiscoveryReport.ts", "lib/customerSuccess/detectVenueViewMilestones.ts", "lib/customerSuccess/venueViewMilestones.ts", "lib/customerSuccess/eligibility.ts"]) {
    assert.doesNotMatch(read(f), /scoutReport/, f);
  }
});
