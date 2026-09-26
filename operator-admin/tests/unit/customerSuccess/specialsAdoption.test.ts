import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  countDailySpecialsForAdoption as countWithWindows,
  isOperatorCreatedDailySpecial as isOperatorCreatedWithWindows,
  toImpersonationWindow,
  type DailySpecialCountRow,
  type ImpersonationWindow,
} from "../../../src/lib/customerSuccess/dailySpecialAdoptionCounts";
import {
  deriveOnboardingStatus,
  hasAdoptedDailySpecials,
  isSpecialsCampaignCandidate,
} from "../../../src/lib/customerSuccess/specialsAdoptionPolicy";

const TODAY = "2026-09-26";
const OPERATOR_ID = "5ff93236-e969-49d1-90a1-87c5c87eef7e";

// Most tests have no staff impersonation for the venue.
const isOperatorCreatedDailySpecial = (r: DailySpecialCountRow) => isOperatorCreatedWithWindows(r, []);
const countDailySpecialsForAdoption = (rows: DailySpecialCountRow[], today: string) => countWithWindows(rows, today, []);

function row(overrides: Partial<DailySpecialCountRow>): DailySpecialCountRow {
  return {
    created_at: "2026-09-12T16:16:19Z",
    created_by_operator_id: OPERATOR_ID,
    schedule_type: "one_time",
    one_time_date: "2026-09-29",
    days_of_week: null,
    recurrence_start_date: null,
    recurrence_end_date: null,
    is_published: true,
    is_seeded_special: false,
    is_genuine_operator_engaged: true,
    ...overrides,
  };
}

// ── Row classification ──────────────────────────────────────────────────────

test("operator-created = not seeded, has an operator creator, genuine provenance", () => {
  assert.equal(isOperatorCreatedDailySpecial(row({})), true);
  assert.equal(isOperatorCreatedDailySpecial(row({ is_seeded_special: true, is_genuine_operator_engaged: false, created_by_operator_id: null })), false);
  // HHC staff via Open as Operator, never touched by the operator: not genuine.
  assert.equal(isOperatorCreatedDailySpecial(row({ is_genuine_operator_engaged: false })), false);
});

// ── Origin is decided at creation — an operator EDIT never changes it ──────
// saveDailySpecialAction's edit path sets is_genuine_operator_engaged = true
// (monotonic) but never writes is_seeded_special or created_by_operator_id.
// Each case below is the row AFTER the operator edited it.

test("seeded Special edited by the operator stays seeded/platform", () => {
  const edited = row({ is_seeded_special: true, created_by_operator_id: null, is_genuine_operator_engaged: true });
  assert.equal(isOperatorCreatedDailySpecial(edited), false);
  const counts = countDailySpecialsForAdoption([edited], TODAY);
  assert.equal(counts.operatorTotal, 0);
  assert.equal(counts.seeded, 1);
});

test("support-mode (unclaimed venue) one-time Special edited by the operator stays platform", () => {
  // shouldStampSeededOnCreate() only seeds WEEKLY support-mode rows, so a
  // one-time support-mode row is is_seeded_special = false with no creator.
  const edited = row({ is_seeded_special: false, created_by_operator_id: null, is_genuine_operator_engaged: true });
  assert.equal(isOperatorCreatedDailySpecial(edited), false);
  assert.equal(countDailySpecialsForAdoption([edited], TODAY).platformTotal, 1);
});

test("Open as Operator (staff) Special edited by the operator stays platform", () => {
  const session: ImpersonationWindow = { startedAt: "2026-09-12T16:00:00Z", endedAt: "2026-09-12T17:00:00Z" };
  const edited = row({ created_at: "2026-09-12T16:30:00Z", is_genuine_operator_engaged: true });
  assert.equal(isOperatorCreatedWithWindows(edited, [session]), false);
  // Same row created outside any staff session is genuinely operator-created.
  assert.equal(isOperatorCreatedWithWindows(row({ created_at: "2026-09-12T18:00:00Z" }), [session]), true);
  // Window boundaries are inclusive (same as migration 096).
  assert.equal(isOperatorCreatedWithWindows(row({ created_at: "2026-09-12T17:00:00Z" }), [session]), false);
});

test("impersonation window = started_at .. COALESCE(ended_at, expires_at)", () => {
  assert.deepEqual(toImpersonationWindow({ started_at: "a", ended_at: "b", expires_at: "c" }), { startedAt: "a", endedAt: "b" });
  assert.deepEqual(toImpersonationWindow({ started_at: "a", ended_at: null, expires_at: "c" }), { startedAt: "a", endedAt: "c" });
  assert.equal(toImpersonationWindow({ started_at: "a", ended_at: null, expires_at: null }), null);
});

test("edit path never writes seeded origin or creator; insert path is the only place it is set", () => {
  const src = readFileSync(join(__dirname, "../../../src/app/admin/daily-specials/actions.ts"), "utf8");
  const fieldsBlock = src.slice(src.indexOf("const fields = {"), src.indexOf("// ── 9. Save"));
  assert.doesNotMatch(fieldsBlock, /is_seeded_special/);
  assert.doesNotMatch(fieldsBlock, /created_by_operator_id/);
  const insertAt = src.indexOf(".insert([{");
  assert.ok(src.indexOf("is_seeded_special: shouldStampSeededOnCreate(") > insertAt);
  assert.ok(src.indexOf("created_by_operator_id: ctx.operator.id") > insertAt);
});

test("The Placery: 7 separate one-time entries = total 7, current/upcoming 5 on Sep 26", () => {
  const dates = ["2026-09-15", "2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27"];
  const counts = countDailySpecialsForAdoption(dates.map((d) => row({ one_time_date: d })), TODAY);
  assert.deepEqual(counts, { operatorTotal: 7, operatorCurrentOrUpcoming: 5, operatorDrafts: 0, platformTotal: 0, seeded: 0 });
  assert.equal(hasAdoptedDailySpecials(counts), true);
});

test("seeded Specials are counted separately and never as adoption", () => {
  const seeded = row({ schedule_type: "weekly", one_time_date: null, days_of_week: [2], is_seeded_special: true, is_genuine_operator_engaged: false });
  const counts = countDailySpecialsForAdoption([seeded, seeded, seeded], TODAY);
  assert.deepEqual(counts, { operatorTotal: 0, operatorCurrentOrUpcoming: 0, operatorDrafts: 0, platformTotal: 3, seeded: 3 });
  assert.equal(hasAdoptedDailySpecials(counts), false);
});

test("a weekly Special is one entry regardless of generated occurrences", () => {
  const counts = countDailySpecialsForAdoption(
    [row({ schedule_type: "weekly", one_time_date: null, days_of_week: [1, 2, 3, 4, 5] })],
    TODAY
  );
  assert.equal(counts.operatorTotal, 1);
  assert.equal(counts.operatorCurrentOrUpcoming, 1);
});

test("drafts count toward total, never toward current/upcoming", () => {
  const counts = countDailySpecialsForAdoption([row({ is_published: false })], TODAY);
  assert.equal(counts.operatorTotal, 1);
  assert.equal(counts.operatorDrafts, 1);
  assert.equal(counts.operatorCurrentOrUpcoming, 0);
});

test("expired weekly Special counts toward total but not current/upcoming", () => {
  const counts = countDailySpecialsForAdoption(
    [row({ schedule_type: "weekly", one_time_date: null, days_of_week: [2], recurrence_end_date: "2026-09-01" })],
    TODAY
  );
  assert.equal(counts.operatorTotal, 1);
  assert.equal(counts.operatorCurrentOrUpcoming, 0);
});

test("zero-Special venue: all zeroes", () => {
  assert.deepEqual(countDailySpecialsForAdoption([], TODAY), {
    operatorTotal: 0, operatorCurrentOrUpcoming: 0, operatorDrafts: 0, platformTotal: 0, seeded: 0,
  });
});

// ── Onboarding status (mirrors Venue Funnel lanes 3-7) ──────────────────────

test("deriveOnboardingStatus follows the Venue Funnel precedence", () => {
  const base = { hasOperator: true, onboardingComplete: false, accountActivatedAt: "2026-08-01T00:00:00Z", missingItemsCount: 3 };
  assert.equal(deriveOnboardingStatus({ ...base, hasOperator: false }), "no_operator");
  assert.equal(deriveOnboardingStatus({ ...base, onboardingComplete: true }), "complete");
  // Manual override counts as complete even without activation.
  assert.equal(deriveOnboardingStatus({ ...base, onboardingComplete: true, accountActivatedAt: null }), "complete");
  assert.equal(deriveOnboardingStatus({ ...base, accountActivatedAt: null }), "not_activated");
  assert.equal(deriveOnboardingStatus(base), "in_progress");
  assert.equal(deriveOnboardingStatus({ ...base, missingItemsCount: 6 }), "not_started");
});

// ── Campaign rule ───────────────────────────────────────────────────────────

test("campaign candidate: >= 14 days since account activation, onboarding in progress/complete, zero operator-created", () => {
  const zero = { operatorTotal: 0 };
  assert.equal(isSpecialsCampaignCandidate({ daysSinceActivation: 14, onboardingStatus: "in_progress", counts: zero }), true);
  assert.equal(isSpecialsCampaignCandidate({ daysSinceActivation: 40, onboardingStatus: "complete", counts: zero }), true);
  assert.equal(isSpecialsCampaignCandidate({ daysSinceActivation: 13, onboardingStatus: "complete", counts: zero }), false);
  // Unknown activation date: stays in the full report, never a candidate.
  assert.equal(isSpecialsCampaignCandidate({ daysSinceActivation: null, onboardingStatus: "complete", counts: zero }), false);
  assert.equal(isSpecialsCampaignCandidate({ daysSinceActivation: 40, onboardingStatus: "not_started", counts: zero }), false);
  assert.equal(isSpecialsCampaignCandidate({ daysSinceActivation: 40, onboardingStatus: "not_activated", counts: zero }), false);
  assert.equal(isSpecialsCampaignCandidate({ daysSinceActivation: 40, onboardingStatus: "complete", counts: { operatorTotal: 1 } }), false);
});

test("report computes campaign age from the Venue Funnel's activation date, not claimed_at", () => {
  const src = readFileSync(join(__dirname, "../../../src/lib/data/specialsAdoption.ts"), "utf8");
  assert.match(src, /const daysSinceActivation = daysSince\(accountActivatedAt\);/);
  assert.match(src, /const accountActivatedAt = op\?\.account_activated_at \?\? null;/);
  assert.doesNotMatch(src, /daysSince\(v\.claimed_at\)/);
  // Same calculation the Venue Funnel uses for "Since account activated".
  const funnel = readFileSync(join(__dirname, "../../../src/lib/data/venueFunnel.ts"), "utf8");
  assert.match(funnel, /ageDays = daysSince\(input\.accountActivatedAt\);/);
});

test("a venue with only seeded Specials is still a campaign candidate", () => {
  const seeded = row({ is_seeded_special: true, is_genuine_operator_engaged: false });
  const counts = countDailySpecialsForAdoption([seeded], TODAY);
  assert.equal(isSpecialsCampaignCandidate({ daysSinceActivation: 30, onboardingStatus: "complete", counts }), true);
});
