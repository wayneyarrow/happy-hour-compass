import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression protection for Part 18/Part 19 of the Phase 2B task: every
 * plan-change event must identify the exact venue — never
 * getOperatorVenues()[0] or any other "first/alphabetical venue" guess.
 * Static verification, matching this repo's convention for files with no
 * DI seam for their real Supabase/Slack/email calls.
 */

const PLAN_CHANGE_EVENTS_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/planChangeEvents.ts"),
  "utf8"
);

test("PlanChangeEventPayload.venueId is a required (non-optional) string field", () => {
  const type = PLAN_CHANGE_EVENTS_SOURCE.match(/export interface PlanChangeEventPayload \{[\s\S]*?\n\}/)![0];
  assert.match(type, /venueId:\s*string;/);
  // Must not be optional (`venueId?:`) — that would allow a caller to omit it.
  assert.doesNotMatch(type, /venueId\?:/);
});

test("plan_change_events insert writes venue_id from payload.venueId directly", () => {
  const insertCall = PLAN_CHANGE_EVENTS_SOURCE.match(/\.from\("plan_change_events"\)\.insert\(\{[\s\S]*?\}\);/)![0];
  assert.match(insertCall, /venue_id:\s*payload\.venueId,/);
});

test("getOperatorVenues() is never imported or called — the confirmed pre-Phase-2B guessing mechanism is fully removed", () => {
  // The header comment legitimately explains this rule in prose, naming the
  // old function — only an actual import/call is checked for here.
  assert.doesNotMatch(PLAN_CHANGE_EVENTS_SOURCE, /import\s*\{[^}]*getOperatorVenues/);
  assert.doesNotMatch(PLAN_CHANGE_EVENTS_SOURCE, /await getOperatorVenues\(/);
  assert.doesNotMatch(PLAN_CHANGE_EVENTS_SOURCE, /venues\[0\]/);
});

test("notifyFounderOfPlanChange() resolves the venue by a direct id lookup (payload.venueId), not a list query", () => {
  const fn = PLAN_CHANGE_EVENTS_SOURCE.match(/async function notifyFounderOfPlanChange[\s\S]*?\n\}/)![0];
  assert.match(fn, /\.from\("venues"\)\.select\("id, name"\)\.eq\("id", payload\.venueId\)\.maybeSingle\(\)/);
});

test("Slack and email notifications both receive the real venueId, not a derived/guessed one", () => {
  const fn = PLAN_CHANGE_EVENTS_SOURCE.match(/async function notifyFounderOfPlanChange[\s\S]*?\n\}/)![0];
  assert.match(fn, /\*Venue ID:\* \$\{payload\.venueId\}/);
  assert.match(fn, /venueId:\s*payload\.venueId,/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Every live call site passes a real venueId — never a guess
// ═══════════════════════════════════════════════════════════════════════════

const LIVE_CALL_SITES = [
  "../../../src/app/api/webhooks/stripe/route.ts",
  "../../../src/app/admin/subscription/changePlanAction.ts",
  "../../../src/app/admin/venue/cancelActions.ts",
];

for (const relPath of LIVE_CALL_SITES) {
  test(`${relPath}: every logPlanChangeEvent() call passes an explicit venueId field`, () => {
    const source = readFileSync(join(__dirname, relPath), "utf8");
    const calls = source.match(/logPlanChangeEvent\(\{[\s\S]*?\}\);/g) ?? [];
    assert.ok(calls.length > 0, `expected at least one logPlanChangeEvent call in ${relPath}`);
    for (const call of calls) {
      assert.match(call, /venueId(,|:)/, `call site missing venueId: ${call}`);
    }
  });
}
