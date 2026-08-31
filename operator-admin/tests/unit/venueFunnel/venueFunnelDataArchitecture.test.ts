import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 2C — structural regression coverage for the DB-fetching side of
 * src/lib/data/venueFunnel.ts and the read-only board UI
 * (src/app/control-panel/venue-funnel/VenueFunnelBoard.tsx). Both call
 * createAdminClient()/Supabase (or render without a DOM-testing harness —
 * this repo has none, confirmed in googleIdentityPanel.test.ts), so these
 * are static, structural verifications of the actual source text — same
 * convention as every other flow-specific contract test in this repo.
 *
 * The pure classification logic itself is covered with real function calls
 * in venueFunnelLaneClassification.test.ts.
 */

const DATA_SOURCE = readFileSync(join(__dirname, "../../../src/lib/data/venueFunnel.ts"), "utf8");
const BOARD_SOURCE = readFileSync(join(__dirname, "../../../src/app/control-panel/venue-funnel/VenueFunnelBoard.tsx"), "utf8");

// ── 1 & 2. Entry-state status lists ──────────────────────────────────────────

test("1. Claim Submitted queries venue_claims filtered to all active pre-approval statuses (pending, needs_more_info, info_submitted) — never the terminal approved/rejected", () => {
  assert.match(DATA_SOURCE, /const ACTIVE_CLAIM_STATUSES = \["pending", "needs_more_info", "info_submitted"\];/);
  assert.match(DATA_SOURCE, /\.in\("status", ACTIVE_CLAIM_STATUSES\)/);
  for (const excluded of ["approved", "rejected"]) {
    assert.doesNotMatch(DATA_SOURCE, new RegExp(`ACTIVE_CLAIM_STATUSES[\\s\\S]*?"${excluded}"`));
  }
});

test("all three active claim statuses (pending, needs_more_info, info_submitted) map to the SAME laneKey literal — the lane never branches by status", () => {
  // The card-construction .map() sets laneKey: "claim_submitted" once, as a
  // literal, for every row this query returns — there is no per-status
  // branch that would route e.g. needs_more_info to a different lane.
  const claimCardsBlock = DATA_SOURCE.match(/const claimCards: VenueFunnelCard\[\] = claims[\s\S]*?\.map\(\(c\) => \{[\s\S]*?\n {4}\}\);/)![0];
  const laneKeyAssignments = claimCardsBlock.match(/laneKey: "[a-z_]+"/g) ?? [];
  assert.deepEqual(laneKeyAssignments, ['laneKey: "claim_submitted"']);
});

test("claim status is carried onto the card as claimStatus — raw value, not a re-derived lane", () => {
  assert.match(DATA_SOURCE, /claimStatus: c\.status,/);
});

test("4. approved/rejected claims never appear anywhere in venueFunnel.ts's claim handling — no separate query or branch reintroduces them", () => {
  assert.doesNotMatch(DATA_SOURCE, /"approved"/);
  assert.doesNotMatch(DATA_SOURCE, /"rejected"/);
});

test("2. Venue Submitted uses exactly the Phase 2A-verified active statuses — no rejected/closed/completed/confirmed_auto/double_claim", () => {
  assert.match(
    DATA_SOURCE,
    /const ACTIVE_SUBMISSION_STATUSES = \["new", "no_match", "pending_review", "info_submitted", "needs_more_info"\];/
  );
  for (const excluded of ["confirmed_auto", "double_claim", "rejected", "rejected_by_user", "closed", "converted_to_operator"]) {
    assert.doesNotMatch(DATA_SOURCE, new RegExp(`ACTIVE_SUBMISSION_STATUSES[\\s\\S]*?"${excluded}"`));
  }
});

// ── 15. Entry cards never duplicate an already-activated venue ──────────────

test("15. a pending claim whose target venue is already claimed is excluded from Claim Submitted", () => {
  assert.match(DATA_SOURCE, /claims\s*\n\s*\.filter\(\(c\) => \(firstEmbedded\(c\.venues\)\?\.claimed_at \?\? null\) === null\)/);
});

test("15b. a pending_review submission whose target venue is already claimed (via any other path) is excluded from Venue Submitted", () => {
  const fn = DATA_SOURCE.match(/const submissionCards[\s\S]*?\.map\(/)![0];
  assert.match(fn, /submissionVenueClaimedAt\.get\(s\.venue_id\) \?\? null\) === null/);
});

// ── 18. Empty-lane rendering ──────────────────────────────────────────────────

test("18. every lane (including empty ones) renders a 'No venues' state rather than being hidden", () => {
  assert.match(BOARD_SOURCE, /No venues/);
  assert.doesNotMatch(BOARD_SOURCE, /lane\.cards\.length === 0[\s\S]{0,40}return null/);
});

test("lanes are always rendered from the full LANE_ORDER, never filtered out when a lane has zero cards", () => {
  assert.match(DATA_SOURCE, /const lanes: FunnelLane\[\] = LANE_ORDER\.map\(/);
  assert.doesNotMatch(DATA_SOURCE, /LANE_ORDER\.filter/);
});

// ── 19. Batched queries — no per-card DB query pattern ────────────────────────

test("19. venue/media/subscription/operator queries are batched via .in(...), never issued inside a per-card loop", () => {
  assert.match(DATA_SOURCE, /\.from\("media"\)\.select\("venue_id, url"\)\.in\("venue_id", activeVenueIds\)/);
  assert.match(DATA_SOURCE, /\.from\("venue_subscriptions"\)\.select\("venue_id, plan_code, status"\)\.in\("venue_id", activeVenueIds\)/);
  assert.match(DATA_SOURCE, /\.from\("operators"\)[\s\S]*?\.in\("id", opIds\)/);
});

test("19b. getUpgradeOpportunities() is invoked exactly once (not once per venue) — reused as a single batched call", () => {
  const invocations = DATA_SOURCE.match(/await getUpgradeOpportunities\(\)/g) ?? [];
  assert.equal(invocations.length, 1, `expected exactly one \`await getUpgradeOpportunities()\` call site, found ${invocations.length}`);
  // And that lone call site sits outside any per-venue loop/map.
  const callSiteLine = DATA_SOURCE.split("\n").find((l) => l.includes("await getUpgradeOpportunities()"))!;
  assert.match(callSiteLine, /const upgradeOpportunityVenueIds = new Set\(/);
});

test("19c. no `await supabase` call appears inside a .map()/.forEach() callback (the per-card N+1 pattern this task must avoid)", () => {
  // Every .map( that constructs cards operates on already-fetched arrays —
  // none of them contain their own `await supabase` call.
  const mapBlocks = DATA_SOURCE.match(/\.map\(\([^)]*\) => \{[\s\S]*?\n  \}\);/g) ?? [];
  assert.ok(mapBlocks.length > 0, "expected to find at least one .map() card-construction block");
  for (const block of mapBlocks) {
    assert.doesNotMatch(block, /await supabase/);
  }
});

// ── Reuse — no independently reimplemented business rules ────────────────────

test("reuses Action Center's canonical helpers directly rather than reimplementing setup-health, plan resolution, or upgrade-opportunity logic", () => {
  assert.match(
    DATA_SOURCE,
    /import \{\s*\n\s*computeSetupHealth,\s*\n\s*buildVenuePlanMap,\s*\n\s*getUpgradeOpportunities,\s*\n\s*daysSince,\s*\n\s*VENUE_SELECT,\s*\n\s*INACTIVE_DAYS,/
  );
  assert.doesNotMatch(DATA_SOURCE, /function computeVenueSetupStatus/);
  assert.doesNotMatch(DATA_SOURCE, /function buildPlanMap/);
});

// ── Card shape carries onboardingCompletionMode (the "manual" indicator) ────

test("8b. venue cards carry onboardingCompletionMode straight through from computeSetupHealth — the UI badge reads this, not a separate lane", () => {
  assert.match(DATA_SOURCE, /onboardingCompletionMode,\n/);
  assert.match(BOARD_SOURCE, /card\.onboardingCompletionMode === "manual"/);
  assert.match(BOARD_SOURCE, /Complete — Manual/);
});

test("the Complete — Manual badge condition in the board is not additionally gated on laneKey — it reads only card.onboardingCompletionMode", () => {
  const badgeBlock = BOARD_SOURCE.match(/\{card\.onboardingCompletionMode === "manual" && \([\s\S]*?\)\}/)![0];
  assert.doesNotMatch(badgeBlock, /laneKey/);
});

test("onboardingCompletionMode is assigned unconditionally on the venue card — a bare identifier, never a ternary/if referencing laneKey (it follows the venue's own override state, not which lane it lands in)", () => {
  const commentAndField = DATA_SOURCE.match(/\/\/ onboardingCompletionMode is deliberately assigned[\s\S]*?\n\s*onboardingCompletionMode,/)![0];
  // The field is a bare identifier shorthand on its own line — never
  // `laneKey === "onboarding_complete" ? onboardingCompletionMode : null`.
  assert.doesNotMatch(commentAndField.split("\n").pop()!, /laneKey|\?|:/);
});

test("classifyVenueLane()'s return type has no onboardingCompletionMode field at all — lane precedence is structurally blind to completion mode", () => {
  const returnType = DATA_SOURCE.match(/export type VenueLaneClassification = \{[\s\S]*?\n\};/)![0];
  assert.doesNotMatch(returnType, /onboardingCompletionMode/);
});

// ── Card shape carries subscriptionStatus (the "Past Due" badge) ────────────

test("12b. venue cards carry the raw subscription status (not just resolved plan) so a Past Due badge can be shown on Paid Plan cards", () => {
  assert.match(DATA_SOURCE, /subscriptionStatus: subStatusByVenue\.get\(v\.id\) \?\? null,/);
  assert.match(BOARD_SOURCE, /card\.subscriptionStatus === "past_due"/);
  assert.match(BOARD_SOURCE, /Past Due/);
});

// ── No fabricated age where no reliable timestamp exists ─────────────────────

test("Onboarding Complete / Upgrade Opportunity / Paid Plan cards never get a fabricated ageDays/ageLabel — those branches leave both null", () => {
  // classifyVenueLane only sets ageDays/ageLabel inside the accountActivatedAt
  // and setup-sent/stalled branches; the paid/upgrade/complete branches fall
  // straight to the (null, null) defaults declared at the top of the function.
  const fn = DATA_SOURCE.match(/export function classifyVenueLane\([\s\S]*?\n}/)![0];
  assert.match(fn, /let ageDays: number \| null = null;/);
  assert.match(fn, /let ageLabel: string \| null = null;/);
});

// ── Navigation ────────────────────────────────────────────────────────────────

test("Venue Funnel has a nav entry in the Control Panel side nav", () => {
  const navSource = readFileSync(
    join(__dirname, "../../../src/app/control-panel/ControlPanelSideNav.tsx"),
    "utf8"
  );
  assert.match(navSource, /\{ label: "Venue Funnel",\s*href: "\/control-panel\/venue-funnel" \}/);
});

// ── No drag-and-drop ──────────────────────────────────────────────────────────

test("the board has no drag-and-drop affordance — lane assignment is entirely system-derived", () => {
  assert.doesNotMatch(BOARD_SOURCE, /draggable/i);
  assert.doesNotMatch(BOARD_SOURCE, /onDragStart/);
  assert.doesNotMatch(BOARD_SOURCE, /onDrop/);
  assert.doesNotMatch(BOARD_SOURCE, /react-dnd|dnd-kit|react-beautiful-dnd/);
});
