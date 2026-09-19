import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-inspection tests for the Phase 2A-3 cron route and vercel.json
 * schedule — same no-live-server convention as this suite's other wiring
 * tests (e.g. activationLifecycleActionsWiring.test.ts).
 */

const ROUTE_PATH = join(__dirname, "../../../src/app/api/cron/operator-activation-reminders/route.ts");
const ROUTE_SOURCE = readFileSync(ROUTE_PATH, "utf8");
// Comment-stripped — the route's own header comment legitimately explains
// (in prose) why there is no dryRun parameter, which would otherwise make a
// blanket doesNotMatch(/dryRun/) false-positive on the comment itself. This
// mirrors the "prose vs actual code" distinction already established
// elsewhere in this suite (e.g. dailySpecialsFoundation.test.ts's CODE_ONLY).
const ROUTE_CODE_ONLY = ROUTE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const CS_ROUTE_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/api/cron/customer-success-deliveries/route.ts"),
  "utf8"
);

const VERCEL_JSON = JSON.parse(readFileSync(join(__dirname, "../../../vercel.json"), "utf8"));

test("route authenticates with CRON_SECRET exactly like the existing customer-success cron route", () => {
  assert.match(ROUTE_SOURCE, /process\.env\.CRON_SECRET/);
  assert.match(ROUTE_SOURCE, /Authorization/);
  assert.match(ROUTE_SOURCE, /`Bearer \$\{expected\}`/);
  // Same shape as the established route, not a reinvented auth mechanism.
  assert.match(CS_ROUTE_SOURCE, /`Bearer \$\{expected\}`/);
});

test("an invalid/missing bearer token gets a generic 401 Unauthorized — no detail leaked", () => {
  const idx = ROUTE_SOURCE.indexOf("authHeader !==");
  const block = ROUTE_SOURCE.slice(idx, idx + 300);
  assert.match(block, /status:\s*401/);
  assert.match(block, /"Unauthorized"/);
});

test("missing CRON_SECRET configuration itself is refused with a generic 500, never proceeding to the orchestrator", () => {
  const idx = ROUTE_SOURCE.indexOf("if (!expected)");
  const block = ROUTE_SOURCE.slice(idx, idx + 300);
  assert.match(block, /status:\s*500/);
  assert.doesNotMatch(block, /processActivationReminders\(/);
});

test("maxDuration is exactly 60, matching the established cron budget", () => {
  assert.match(ROUTE_SOURCE, /export const maxDuration = 60;/);
});

test("the route calls processActivationReminders() with NO arguments — no caller-controlled dependency injection, no dryRun parameter", () => {
  assert.match(ROUTE_CODE_ONLY, /processActivationReminders\(\)/);
  assert.doesNotMatch(ROUTE_CODE_ONLY, /dryRun/);
  assert.doesNotMatch(ROUTE_CODE_ONLY, /searchParams/);
  assert.doesNotMatch(ROUTE_CODE_ONLY, /request\.json\(/);
});

test("the route never imports or calls planActivationReminders() — the read-only planning entry point is unreachable from the network", () => {
  assert.doesNotMatch(ROUTE_SOURCE, /planActivationReminders/);
});

test("the route never logs the Authorization header or the CRON_SECRET value", () => {
  assert.doesNotMatch(ROUTE_SOURCE, /console\.(log|error|warn)\([^)]*authHeader/);
  assert.doesNotMatch(ROUTE_SOURCE, /console\.(log|error|warn)\([^)]*expected\b[^)]*\)/);
});

test("the route exports no 'use server' action — this is a plain Next.js Route Handler, not a Server Action surface", () => {
  assert.doesNotMatch(ROUTE_SOURCE, /"use server";/);
});

test("vercel.json adds exactly one new cron entry for operator-activation-reminders, hourly", () => {
  const entry = VERCEL_JSON.crons.find((c: { path: string }) => c.path === "/api/cron/operator-activation-reminders");
  assert.ok(entry, "expected a cron entry for /api/cron/operator-activation-reminders");
  assert.equal(entry.schedule, "0 * * * *");
});

test("vercel.json's two pre-existing cron entries are unchanged", () => {
  const brevo = VERCEL_JSON.crons.find((c: { path: string }) => c.path === "/api/cron/brevo-sync-outbox");
  const cs = VERCEL_JSON.crons.find((c: { path: string }) => c.path === "/api/cron/customer-success-deliveries");
  assert.ok(brevo && cs);
  assert.equal(brevo.schedule, "*/10 * * * *");
  assert.equal(cs.schedule, "0 * * * *");
});

test("vercel.json now has exactly three cron entries total", () => {
  assert.equal(VERCEL_JSON.crons.length, 3);
});

test("the dry-run script requires --dry-run and has no --apply/live-mode flag anywhere in its executable code", () => {
  const scriptSource = readFileSync(join(__dirname, "../../../scripts/processActivationReminders.ts"), "utf8");
  // Comment-stripped — the header comment explicitly explains (in prose)
  // that there is NO --apply flag, which would otherwise false-positive a
  // blanket doesNotMatch(/--apply/) on that very sentence.
  const codeOnly = scriptSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.match(scriptSource, /--dry-run/);
  assert.doesNotMatch(codeOnly, /--apply/);
  assert.doesNotMatch(codeOnly, /dryRun:\s*false/);
  assert.match(codeOnly, /process\.exit\(1\)/);
});

test("processActivationReminders.ts (the orchestrator) has no \"use server\" directive — it is never itself network-reachable", () => {
  const orchestratorSource = readFileSync(join(__dirname, "../../../src/lib/activation/processActivationReminders.ts"), "utf8");
  assert.doesNotMatch(orchestratorSource, /"use server";/);
});
