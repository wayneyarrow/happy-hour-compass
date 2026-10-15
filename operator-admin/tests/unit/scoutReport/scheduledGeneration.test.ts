import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScoutReport, type ScoutReport } from "../../../src/lib/scoutReport/buildScoutReport";
import {
  MAX_ATTEMPTS,
  SCOUT_CRON_SCHEDULES,
  STALE_LEASE_MS,
  runScheduledScoutReport,
  sanitizeFailureMessage,
  scheduleDecision,
  shouldStoreNewReport,
  type ScheduledGenerationDeps,
  type ScoutAlert,
} from "../../../src/lib/scoutReport/storage/scheduledGeneration";
import { ReportTooLargeError } from "../../../src/lib/data/searchDiscoveryReport";
import { fakeDeps } from "./fixtures";
import { MemoryScoutStore } from "./memoryStore";

// Monday Oct 19 2026: 10:00 PDT = 17:00Z. The period is Oct 12–18.
const T = (iso: string) => new Date(iso);
const MON_10_00 = T("2026-10-19T17:00:00Z");
const MON_10_20 = T("2026-10-19T17:20:00Z");
const MON_10_40 = T("2026-10-19T17:40:00Z");
const PERIOD_START = "2026-10-12T07:00:00.000Z";

/** Builder backed by the stage-one fixtures (no database). `over` lets a test make a section fail. */
function fixtureBuild(over: Parameters<typeof fakeDeps>[0] = {}) {
  const calls: Date[] = [];
  return {
    calls,
    build: (now: Date) => {
      calls.push(now);
      return buildScoutReport({ now, deps: fakeDeps(over).deps });
    },
  };
}

function deps(store: MemoryScoutStore, now: Date, over: Partial<ScheduledGenerationDeps> = {}) {
  const alerts: ScoutAlert[] = [];
  let storesCreated = 0;
  const d: ScheduledGenerationDeps = {
    enabled: true,
    trigger: "scheduled",
    environment: "production",
    now: () => now,
    createStore: () => (storesCreated++, store),
    build: fixtureBuild().build,
    sendAlert: async (a) => void alerts.push(a),
    builderVersion: "c803c67",
    ...over,
  };
  return { d, alerts, storesCreated: () => storesCreated };
}

const failingProductUsage = { usage: { loadVenueViewRows: async () => { throw new Error("venue_view_events page 0 failed: statement timeout"); } } };
const persistentSearchFailure = { searchDiscovery: { loadDiscoveryRows: async () => { throw new ReportTooLargeError("website_discovery_events", 150_001); } } };

// ── Schedule ────────────────────────────────────────────────────────────────

test("schedule: Monday 10:xx Vancouver only — 17:xx UTC under PDT, 18:xx UTC under PST", () => {
  assert.deepEqual(scheduleDecision(T("2026-10-19T17:00:00Z"), true), { run: true, finalPass: false });
  assert.deepEqual(scheduleDecision(T("2026-10-19T17:40:00Z"), true), { run: true, finalPass: true });
  assert.equal(scheduleDecision(T("2026-10-19T18:00:00Z"), true).run, false, "11:00 PDT");
  assert.equal(scheduleDecision(T("2026-11-02T17:00:00Z"), true).run, false, "09:00 PST, after DST ended Nov 1");
  assert.equal(scheduleDecision(T("2026-11-02T18:00:00Z"), true).run, true, "10:00 PST");
  assert.equal(scheduleDecision(T("2027-03-15T17:00:00Z"), true).run, true, "10:00 PDT, after DST began Mar 14");
  assert.equal(scheduleDecision(T("2026-10-20T17:00:00Z"), true).run, false, "Tuesday");
  assert.equal(scheduleDecision(T("2026-10-20T17:00:00Z"), false).run, true, "window not enforced (manual staging QA)");
});

test("schedule: across a year of Mondays, exactly the three 10:00/10:20/10:40 local passes run each week", () => {
  const minuteHour = SCOUT_CRON_SCHEDULES.map((s) => s.split(" ").slice(0, 2).map(Number) as [number, number]);
  assert.ok(SCOUT_CRON_SCHEDULES.every((s) => s.endsWith(" * * 1")), "Mondays only, UTC (Vercel cron has no time zone)");
  for (let d = Date.UTC(2026, 9, 19); d < Date.UTC(2027, 9, 19); d += 7 * 86_400_000) {
    const runs = minuteHour.map(([m, h]) => new Date(d + h * 3_600_000 + m * 60_000)).filter((t) => scheduleDecision(t, true).run);
    const local = runs.map((t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t));
    assert.deepEqual(local, ["10:00", "10:20", "10:40"], new Date(d).toISOString());
  }
});

// ── Gates ───────────────────────────────────────────────────────────────────

test("disabled: nothing is read, written, built or sent", async () => {
  const store = new MemoryScoutStore();
  const b = fixtureBuild();
  const { d, alerts, storesCreated } = deps(store, MON_10_00, { enabled: false, build: b.build });
  assert.equal((await runScheduledScoutReport(d)).outcome, "disabled");
  assert.equal(storesCreated(), 0);
  assert.equal(b.calls.length, 0);
  assert.equal(alerts.length, 0);
});

test("only production and staging may write; outside the window nothing is touched", async () => {
  for (const environment of ["development", "preview"]) {
    const { d, storesCreated } = deps(new MemoryScoutStore(), MON_10_00, { environment });
    assert.equal((await runScheduledScoutReport(d)).outcome, "environment_not_allowed");
    assert.equal(storesCreated(), 0);
  }
  const { d, storesCreated } = deps(new MemoryScoutStore(), T("2026-10-19T18:00:00Z"));
  assert.equal((await runScheduledScoutReport(d)).outcome, "outside_window");
  assert.equal(storesCreated(), 0);
});

// ── Storage ─────────────────────────────────────────────────────────────────

test("stores the stage-one builder's report verbatim for the previous complete week", async () => {
  const store = new MemoryScoutStore();
  const { d } = deps(store, MON_10_00);
  const r = await runScheduledScoutReport(d);
  assert.equal(r.outcome, "stored_complete");
  assert.equal(store.rows.length, 1);
  const row = store.rows[0];
  const expected: ScoutReport = await buildScoutReport({ now: MON_10_00, deps: fakeDeps().deps });
  assert.deepEqual(row.payload, JSON.parse(JSON.stringify(expected)), "payload = the stage-one export");
  assert.equal(row.period_start, PERIOD_START);
  assert.equal(row.period_end, "2026-10-19T07:00:00.000Z");
  assert.equal(row.period_start_date, "2026-10-12");
  assert.equal(row.period_end_date, "2026-10-18");
  assert.equal(row.time_zone, "America/Vancouver");
  assert.equal(row.generation_state, "generated");
  assert.equal(row.completeness, "complete");
  assert.equal(row.schema_version, expected.schemaVersion);
  assert.equal(row.report_generated_at, MON_10_00.toISOString());
  assert.equal(row.lease_started_at, null);
  assert.equal(row.environment, "production");
  assert.equal(row.trigger_source, "scheduled");
});

test("a complete report is never rebuilt or replaced by a later pass", async () => {
  const store = new MemoryScoutStore();
  await runScheduledScoutReport(deps(store, MON_10_00).d);
  const before = structuredClone(store.rows[0]);
  const b = fixtureBuild(failingProductUsage);
  const r = await runScheduledScoutReport(deps(store, MON_10_20, { build: b.build }).d);
  assert.equal(r.outcome, "skipped");
  assert.equal(r.reason, "already_complete");
  assert.equal(b.calls.length, 0);
  assert.deepEqual(store.rows[0], before);
});

test("simultaneous runs (duplicate cron delivery): one builds and stores, the other skips", async () => {
  const store = new MemoryScoutStore();
  const b = fixtureBuild();
  const [a, c] = await Promise.all([
    runScheduledScoutReport(deps(store, MON_10_00, { build: b.build }).d),
    runScheduledScoutReport(deps(store, MON_10_00, { build: b.build }).d),
  ]);
  assert.deepEqual([a.outcome, c.outcome].sort(), ["skipped", "stored_complete"]);
  // Depending on interleaving the duplicate sees the row mid-generation or already stored — never builds it twice.
  assert.ok(["in_progress", "already_complete"].includes([a, c].find((x) => x.outcome === "skipped")!.reason!));
  assert.equal(b.calls.length, 1);
  assert.equal(store.rows.length, 1);
});

test("abandoned run: a fresh lease blocks; a lease older than the stale threshold is taken over", async () => {
  const store = new MemoryScoutStore();
  const lease = new Date(MON_10_20.getTime() - (STALE_LEASE_MS - 60_000)).toISOString();
  store.seed({ period_start: PERIOD_START, environment: "production", generation_state: "generating", lease_started_at: lease, last_attempt_outcome: null });
  assert.equal((await runScheduledScoutReport(deps(store, MON_10_20).d)).reason, "in_progress");

  const later = new Date(Date.parse(lease) + STALE_LEASE_MS + 1);
  const r = await runScheduledScoutReport(deps(store, later).d);
  assert.equal(r.outcome, "stored_complete");
  assert.equal(r.attempt, 2);
  assert.equal(store.rows[0].completeness, "complete");
});

test("attempts are capped per period", async () => {
  const store = new MemoryScoutStore();
  store.seed({ period_start: PERIOD_START, environment: "production", generation_state: "failed", attempt_count: MAX_ATTEMPTS, last_failure: { part: "x", kind: "transient", message: "timeout", at: "t" } });
  const b = fixtureBuild();
  const r = await runScheduledScoutReport(deps(store, MON_10_40, { build: b.build }).d);
  assert.equal(r.reason, "attempts_exhausted");
  assert.equal(b.calls.length, 0);
});

test("incomplete report is stored honestly with its section issues; a transient one is retried and replaced by a complete one", async () => {
  const store = new MemoryScoutStore();
  const first = await runScheduledScoutReport(deps(store, MON_10_00, { build: fixtureBuild(failingProductUsage).build }).d);
  assert.equal(first.outcome, "stored_incomplete");
  const row = store.rows[0];
  assert.equal(row.generation_state, "generated", "generation succeeded…");
  assert.equal(row.completeness, "incomplete", "…the report is incomplete");
  assert.deepEqual(row.incomplete_sections, ["productUsage", "customerSuccess"]);
  assert.equal(row.retry_advice, "suggested");
  const issues = (row.payload as ScoutReport).sections.productUsage.issues;
  assert.equal(issues[0].kind, "transient");

  const second = await runScheduledScoutReport(deps(store, MON_10_20).d);
  assert.equal(second.outcome, "stored_complete");
  assert.equal(store.rows[0].completeness, "complete");
  assert.equal(store.rows[0].attempt_count, 2);
});

test("an incomplete report whose failure isn't temporary is not retried", async () => {
  const store = new MemoryScoutStore();
  await runScheduledScoutReport(deps(store, MON_10_00, { build: fixtureBuild(persistentSearchFailure).build }).d);
  assert.equal(store.rows[0].retry_advice, "not_suggested");
  const b = fixtureBuild();
  const r = await runScheduledScoutReport(deps(store, MON_10_20, { build: b.build }).d);
  assert.equal(r.reason, "not_retryable");
  assert.equal(b.calls.length, 0);
});

test("a retry never replaces a stored incomplete report with one that has fewer complete sections", async () => {
  const store = new MemoryScoutStore();
  // Stored: only Search & Discovery failed (2 complete sections).
  await runScheduledScoutReport(deps(store, MON_10_00, { build: fixtureBuild({ searchDiscovery: { loadDiscoveryRows: async () => { throw new Error("fetch failed"); } } }).build }).d);
  const stored = structuredClone(store.rows[0].payload);
  // Retry: product usage fails, taking customer success with it (1 complete section).
  const r = await runScheduledScoutReport(deps(store, MON_10_20, { build: fixtureBuild(failingProductUsage).build }).d);
  assert.equal(r.outcome, "kept_previous");
  assert.deepEqual(store.rows[0].payload, stored);
  assert.equal(store.rows[0].last_attempt_outcome, "kept_previous");
  assert.equal(store.rows[0].generation_state, "generated");
  assert.equal(shouldStoreNewReport(null, { sections: {} } as never), true);
});

test("generation failure (build throws or times out) is distinct from an incomplete report and stores no payload", async () => {
  const store = new MemoryScoutStore();
  const secret = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV";
  const r = await runScheduledScoutReport(
    deps(store, MON_10_00, { build: async () => { throw new Error(`connect failed for owner@example.com at https://db.example.co/x?key=1 token ${secret}`); } }).d
  );
  assert.equal(r.outcome, "failed");
  const row = store.rows[0];
  assert.equal(row.generation_state, "failed");
  assert.equal(row.payload, null);
  assert.equal(row.completeness, null);
  const msg = row.last_failure!.message;
  for (const leak of ["owner@example.com", "db.example.co", secret]) assert.equal(msg.includes(leak), false, `sanitized: ${leak}`);
  assert.match(msg, /\[email redacted\].*\[url redacted\].*\[token redacted\]/);

  const slow = new MemoryScoutStore();
  const t = await runScheduledScoutReport(deps(slow, MON_10_00, { build: () => new Promise(() => {}), buildTimeoutMs: 20 }).d);
  assert.equal(t.outcome, "failed");
  assert.equal(slow.rows[0].last_failure!.kind, "transient");
  assert.match(slow.rows[0].last_failure!.message, /timed out/);
});

test("a failed retry keeps the earlier incomplete payload (never discards a usable report)", async () => {
  const store = new MemoryScoutStore();
  await runScheduledScoutReport(deps(store, MON_10_00, { build: fixtureBuild(failingProductUsage).build }).d);
  const stored = structuredClone(store.rows[0].payload);
  const r = await runScheduledScoutReport(deps(store, MON_10_20, { build: async () => { throw new Error("socket hang up"); } }).d);
  assert.equal(r.outcome, "failed");
  assert.deepEqual(store.rows[0].payload, stored);
  assert.equal(store.rows[0].generation_state, "generated");
  assert.equal(store.rows[0].completeness, "incomplete");
  assert.equal(store.rows[0].last_attempt_outcome, "failed");
});

test("lost lease: if another run took over, this run writes nothing", async () => {
  const store = new MemoryScoutStore();
  store.finishOverride = () => false;
  const r = await runScheduledScoutReport(deps(store, MON_10_00).d);
  assert.equal(r.outcome, "lease_lost");
});

// ── Alerts ──────────────────────────────────────────────────────────────────

test("alerts: once per period, Production only, only when no better attempt is coming", async () => {
  const store = new MemoryScoutStore();
  const first = deps(store, MON_10_00, { build: fixtureBuild(failingProductUsage).build });
  await runScheduledScoutReport(first.d);
  assert.equal(first.alerts.length, 0, "retry still coming at 10:20/10:40");

  const final = deps(store, MON_10_40, { build: fixtureBuild(failingProductUsage).build });
  const r = await runScheduledScoutReport(final.d);
  assert.equal(r.alerted, true);
  assert.equal(final.alerts.length, 1);
  assert.match(final.alerts[0].title, /incomplete/);
  const text = JSON.stringify(final.alerts[0]);
  assert.equal(text.includes("venueViews"), false, "no report data in the alert");

  // Persistent failure: alerted immediately, even before the final pass.
  const p = new MemoryScoutStore();
  const pd = deps(p, MON_10_00, { build: fixtureBuild(persistentSearchFailure).build });
  await runScheduledScoutReport(pd.d);
  assert.equal(pd.alerts.length, 1);

  // Staging never alerts.
  const s = new MemoryScoutStore();
  const sd = deps(s, MON_10_40, { environment: "staging", build: async () => { throw new Error("boom"); } });
  await runScheduledScoutReport(sd.d);
  assert.equal(sd.alerts.length, 0);
  assert.equal(s.rows[0].environment, "staging");
  assert.equal(s.rows[0].trigger_source, "manual");
});

test("staging rows never collide with the production report for the same period", async () => {
  const store = new MemoryScoutStore();
  await runScheduledScoutReport(deps(store, MON_10_00, { environment: "staging" }).d);
  const prod = await runScheduledScoutReport(deps(store, MON_10_00).d);
  assert.equal(prod.outcome, "stored_complete");
  assert.deepEqual(store.rows.map((r) => r.environment).sort(), ["production", "staging"]);
});

// ── Retention ───────────────────────────────────────────────────────────────

test("retention: deletes only this type + environment's reports older than 26 weeks", async () => {
  const store = new MemoryScoutStore();
  const old = store.seed({ period_start: "2026-04-06T07:00:00.000Z", environment: "production", completeness: "complete" }); // 27 weeks before Oct 12
  const kept = store.seed({ period_start: "2026-04-13T07:00:00.000Z", environment: "production", completeness: "complete" }); // exactly 26 weeks
  const otherEnv = store.seed({ period_start: "2026-01-05T08:00:00.000Z", environment: "staging" });
  const r = await runScheduledScoutReport(deps(store, MON_10_00).d);
  assert.equal(r.retentionDeleted, 1);
  const ids = store.rows.map((x) => x.id);
  assert.ok(!ids.includes(old.id));
  assert.ok(ids.includes(kept.id));
  assert.ok(ids.includes(otherEnv.id), "other environment untouched");
  assert.ok(store.calls.some((c) => c === "deleteOlderThan product_usage_and_discovery production 2026-04-13T07:00:00.000Z"));
});

test("sanitizer bounds length and strips bearer tokens", () => {
  assert.equal(sanitizeFailureMessage("Bearer abc.def.ghi failed"), "Bearer [redacted] failed");
  assert.ok(sanitizeFailureMessage("x".repeat(1000)).length <= 300);
});

// ── Regressions: abandoned final attempt, store failures ────────────────────

test("an abandoned FINAL attempt is resolved (not left generating): failed without a payload, alerted once in Production", async () => {
  const store = new MemoryScoutStore();
  const lease = "2026-10-19T17:40:00.000Z";
  store.seed({ period_start: PERIOD_START, environment: "production", generation_state: "generating", lease_started_at: lease, attempt_count: MAX_ATTEMPTS, last_attempt_outcome: null, last_attempt_finished_at: null });
  const b = fixtureBuild();
  const later = new Date(Date.parse(lease) + STALE_LEASE_MS + 60_000); // still Monday 10:xx
  const run = deps(store, later, { build: b.build });
  const r = await runScheduledScoutReport(run.d);
  assert.equal(r.outcome, "abandoned_resolved");
  assert.equal(b.calls.length, 0, "no fourth attempt");
  const row = store.rows[0];
  assert.equal(row.generation_state, "failed");
  assert.equal(row.lease_started_at, null);
  assert.equal(row.last_failure!.kind, "abandoned");
  assert.equal(run.alerts.length, 1);
  // A later pass finds it resolved and does nothing more.
  const again = deps(store, new Date(later.getTime() + 60_000));
  assert.equal((await runScheduledScoutReport(again.d)).reason, "attempts_exhausted");
  assert.equal(again.alerts.length, 0);
});

test("an abandoned final attempt keeps an earlier incomplete payload (generated, still incomplete)", async () => {
  const store = new MemoryScoutStore();
  const lease = "2026-10-19T17:40:00.000Z";
  const payload = { sections: { productUsage: { status: "failed" } } };
  store.seed({ period_start: PERIOD_START, environment: "staging", generation_state: "generating", lease_started_at: lease, attempt_count: MAX_ATTEMPTS, payload, completeness: "incomplete", schema_version: "hhc-scout-report/1.0", report_generated_at: "2026-10-19T17:00:00.000Z" });
  const r = await runScheduledScoutReport(deps(store, new Date(Date.parse(lease) + STALE_LEASE_MS + 1), { environment: "staging" }).d);
  assert.equal(r.outcome, "abandoned_resolved");
  assert.equal(store.rows[0].generation_state, "generated");
  assert.deepEqual(store.rows[0].payload, payload);
  assert.equal(store.rows[0].completeness, "incomplete");
});

test("a store failure is caught: sanitized result, no raw error in the alert, alert only on the final pass", async () => {
  const secretish = 'connection to postgres://svc:pw-hunter2@db.internal:5432 failed for admin@example.com';
  const broken = new MemoryScoutStore();
  broken.insertClaim = async () => { throw new Error(secretish); };
  const early = deps(broken, MON_10_00);
  const r1 = await runScheduledScoutReport(early.d);
  assert.equal(r1.outcome, "store_error");
  assert.equal(early.alerts.length, 0, "not the final pass");
  for (const leak of ["pw-hunter2", "admin@example.com", "db.internal", "svc:", "postgres://"]) assert.equal(JSON.stringify(r1).includes(leak), false, leak);

  const final = deps(broken, MON_10_40);
  const r2 = await runScheduledScoutReport(final.d);
  assert.equal(r2.alerted, true);
  assert.equal(final.alerts.length, 1);
  assert.equal(JSON.stringify(final.alerts[0]).includes("hunter2"), false);
  assert.equal(JSON.stringify(final.alerts[0]).includes("postgres://"), false);

  // Staging: never alerts.
  const s = deps(broken, MON_10_40, { environment: "staging" });
  assert.equal((await runScheduledScoutReport(s.d)).outcome, "store_error");
  assert.equal(s.alerts.length, 0);
});

// ── Trigger: scheduled (network) vs manual (in-process verification) ────────

test("scheduled Production runs keep the Monday window; a manual in-process run is recorded honestly as manual", async () => {
  const thursday = T("2026-10-15T20:00:00Z");
  const sched = deps(new MemoryScoutStore(), thursday);
  assert.equal((await runScheduledScoutReport(sched.d)).outcome, "outside_window");
  assert.equal(sched.storesCreated(), 0);

  const store = new MemoryScoutStore();
  const manual = deps(store, thursday, { trigger: "manual" });
  const r = await runScheduledScoutReport(manual.d);
  assert.equal(r.outcome, "stored_complete");
  assert.equal(store.rows[0].environment, "production");
  assert.equal(store.rows[0].trigger_source, "manual");
  assert.equal(store.rows[0].period_start, "2026-10-05T07:00:00.000Z", "most recent complete week");
  assert.equal(manual.alerts.length, 0);

  // A scheduled run on Monday records "scheduled".
  const mon = new MemoryScoutStore();
  await runScheduledScoutReport(deps(mon, MON_10_00).d);
  assert.equal(mon.rows[0].trigger_source, "scheduled");
});
