import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSupabaseScoutReportStore, getScoutReportById, listScoutReports } from "../../../src/lib/scoutReport/storage/scoutReportStore";
import { SCOUT_CRON_PATH, SCOUT_CRON_SCHEDULES } from "../../../src/lib/scoutReport/storage/scheduledGeneration";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Records every builder call; answers with `result`. */
function recorder(result: { data?: unknown; error?: { code?: string; message: string } | null } = {}) {
  const calls: { table: string; ops: string[] }[] = [];
  const client = {
    from(table: string) {
      const c = { table, ops: [] as string[] };
      calls.push(c);
      const self: Any = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: result.data ?? null, error: result.error ?? null });
            return (...args: unknown[]) => {
              c.ops.push(`${prop}(${args.map((a) => JSON.stringify(a)).join(",")})`);
              return self;
            };
          },
        }
      );
      return self;
    },
  };
  return { client: client as Any, calls };
}

test("store: every query targets scout_reports only", async () => {
  const { client, calls } = recorder({ data: [] });
  const s = createSupabaseScoutReportStore(client);
  await s.getForPeriod({ reportType: "product_usage_and_discovery", environment: "production", periodStart: "p" });
  await s.reclaim("id", { generationState: "failed", leaseStartedAt: null, attemptCount: 1 }, {} as never);
  await s.finish("id", "lease", { lease_started_at: null });
  await s.markAlerted("id", "t");
  await s.deleteOlderThan("product_usage_and_discovery", "production", "cutoff");
  await listScoutReports(client, { reportType: "product_usage_and_discovery", environment: "production" });
  await getScoutReportById(client, { id: "id", environment: "production" });
  assert.deepEqual([...new Set(calls.map((c) => c.table))], ["scout_reports"]);
});

test("store: a unique violation on insert is a 'conflict' (another run owns the period), other errors throw", async () => {
  assert.deepEqual(await createSupabaseScoutReportStore(recorder({ error: { code: "23505", message: "duplicate" } }).client).insertClaim({} as never), { status: "conflict" });
  await assert.rejects(createSupabaseScoutReportStore(recorder({ error: { code: "42501", message: "permission denied" } }).client).insertClaim({} as never), /permission denied/);
});

test("store: take-over is a compare-and-swap pinned to state, attempt count, lease and non-complete", async () => {
  const { client, calls } = recorder({ data: [] });
  const s = createSupabaseScoutReportStore(client);
  assert.equal(await s.reclaim("r1", { generationState: "generating", leaseStartedAt: "L", attemptCount: 2 }, { attempt_count: 3 } as never), null);
  const ops = calls[0].ops;
  assert.ok(ops.includes(`eq("id","r1")`) && ops.includes(`eq("generation_state","generating")`) && ops.includes(`eq("attempt_count",2)`) && ops.includes(`eq("lease_started_at","L")`));
  assert.ok(ops.includes(`or("completeness.is.null,completeness.eq.incomplete")`));
  await s.reclaim("r1", { generationState: "failed", leaseStartedAt: null, attemptCount: 1 }, {} as never);
  assert.ok(calls[1].ops.includes(`is("lease_started_at",null)`));
});

test("store: finish requires the caller's own lease; retention is scoped to one type + environment", async () => {
  const { client, calls } = recorder({ data: [] });
  const s = createSupabaseScoutReportStore(client);
  assert.equal(await s.finish("r1", "L", { lease_started_at: null }), false);
  assert.ok(calls[0].ops.includes(`eq("generation_state","generating")`) && calls[0].ops.includes(`eq("lease_started_at","L")`));
  await s.deleteOlderThan("product_usage_and_discovery", "staging", "2026-04-13T07:00:00.000Z");
  assert.deepEqual(calls[1].ops.filter((o) => !o.startsWith("select")), [
    "delete()",
    `eq("report_type","product_usage_and_discovery")`,
    `eq("environment","staging")`,
    `lt("period_start","2026-04-13T07:00:00.000Z")`,
  ]);
});

test("read helpers return finished reports of one environment only", async () => {
  const { client, calls } = recorder({ data: [] });
  await listScoutReports(client, { reportType: "product_usage_and_discovery", environment: "staging" });
  assert.ok(calls[0].ops.includes(`eq("environment","staging")`));
  assert.ok(calls[0].ops.includes(`eq("generation_state","generated")`));
  const single = recorder({ data: null }); // .maybeSingle() yields null when no row matches
  assert.equal(await getScoutReportById(single.client, { id: "r1", environment: "production" }), null);
  for (const op of [`eq("id","r1")`, `eq("environment","production")`, `eq("generation_state","generated")`]) assert.ok(single.calls[0].ops.includes(op), op);
});

test("history listing excludes the payload and caps the page size", async () => {
  const { client, calls } = recorder({ data: [] });
  await listScoutReports(client, { reportType: "product_usage_and_discovery", environment: "production", limit: 10_000 });
  const select = calls[0].ops.find((o) => o.startsWith("select"))!;
  assert.doesNotMatch(select, /payload|lease_started_at|builder_version/);
  assert.ok(calls[0].ops.includes(`order("period_start",{"ascending":false})`));
  assert.ok(calls[0].ops.includes("limit(100)"));
});

// ── Route, schedule and side-effect wiring ──────────────────────────────────

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("cron route: CRON_SECRET bearer check, kill switch, no request input", () => {
  const src = read("src/app/api/cron/scout-report/route.ts");
  const code = strip(src);
  assert.match(code, /request\.headers\.get\("authorization"\) !== `Bearer \$\{expected\}`/);
  assert.match(code, /if \(!expected\)/);
  assert.match(code, /isScoutReportGenerationEnabled\(\)/);
  assert.doesNotMatch(code, /searchParams|request\.json|request\.text|request\.formData|nextUrl/, "no caller-controlled input");
  assert.equal((code.match(/request\.headers\.get\(/g) ?? []).length, 1, "only the authorization header is read");
  assert.match(code, /channel: "ops-alerts"/);
  assert.match(code, /trigger: "scheduled",/, "the network route can never run in manual (window-free) mode");
  assert.doesNotMatch(code, /trigger: "manual"/);
  const cfg = read("src/lib/scoutReport/storage/generationConfig.ts");
  assert.match(cfg, /process\.env\.SCOUT_REPORT_GENERATION_ENABLED === "true"/);
});

test("storage + generation code: no email, operator contact, AI, other tables or customer-success writes", () => {
  const dir = join(ROOT, "src/lib/scoutReport/storage");
  for (const f of [...readdirSync(dir).map((n) => `src/lib/scoutReport/storage/${n}`), "src/app/api/cron/scout-report/route.ts"]) {
    const code = strip(read(f));
    for (const bad of [/sendTransactionalEmail|resend/i, /openai|anthropic|chat\.completions/i, /processCustomerSuccessDeliveries|applyVenueViewMilestoneDecisions|runVenueViewMilestoneDetection/, /\.rpc\(/]) {
      assert.doesNotMatch(code, bad, `${f}: ${bad}`);
    }
    for (const m of code.matchAll(/\.from\(\s*(["'`]?)(\w+)\1/g)) assert.ok(m[2] === "scout_reports" || m[2] === "TABLE", `${f}: unexpected table ${m[2]}`);
  }
});

test("schedule config: vercel.json has exactly the reviewed Monday UTC entries", () => {
  const vercel = JSON.parse(read("vercel.json")) as { crons?: { path: string; schedule: string }[] };
  const scout = (vercel.crons ?? []).filter((c) => c.path === SCOUT_CRON_PATH).map((c) => c.schedule);
  assert.deepEqual(scout.sort(), [...SCOUT_CRON_SCHEDULES].sort(), "exactly the reviewed UTC entries");
  // Existing crons untouched.
  assert.deepEqual(
    (vercel.crons ?? []).filter((c) => c.path !== SCOUT_CRON_PATH).map((c) => `${c.path} ${c.schedule}`),
    ["/api/cron/brevo-sync-outbox */10 * * * *", "/api/cron/customer-success-deliveries 0 * * * *", "/api/cron/operator-activation-reminders 0 * * * *", "/api/cron/email-open-tracking */15 * * * *"]
  );
});

test("the stage-one manual download is unchanged and still not stored", () => {
  const route = read("src/app/control-panel/analytics/scout-report/route.ts");
  assert.match(route, /await requireControlPanelAdmin\(\);/);
  assert.doesNotMatch(route, /scoutReportStore|storage\//);
  assert.ok(existsSync(join(ROOT, "src/app/control-panel/analytics/ScoutReportDownload.tsx")));
});
