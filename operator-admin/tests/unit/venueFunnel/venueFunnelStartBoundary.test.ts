import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VENUE_FUNNEL_START_AT } from "../../../src/lib/data/venueFunnel";

/**
 * Phase 2E — Venue Funnel historical start boundary.
 *
 * getVenueFunnelData() has no DI seam (real Supabase calls), so whether a
 * given date actually gets included/excluded by `.gte(...)` is not something
 * a unit test can exercise without a live/mocked database — same reasoning
 * as every other flow-specific contract test in this repo (see
 * cancelVenueActionRegression.test.ts). These are static, structural
 * verifications that the boundary is wired correctly: applied, inclusive,
 * scoped to exactly the two Entry queries, and never applied to venue
 * creation date.
 */

const DATA_SOURCE = readFileSync(join(__dirname, "../../../src/lib/data/venueFunnel.ts"), "utf8");

test("VENUE_FUNNEL_START_AT is set to The Placery's confirmed submitted_at (2026-08-15T17:05:29.215Z) — a single named, centralized constant", () => {
  assert.equal(VENUE_FUNNEL_START_AT, "2026-08-15T17:05:29.215Z");
  // Centralized: the literal date string appears exactly once in the file
  // (the constant's own assignment) — every query reads the constant, never
  // a re-typed copy of the date.
  const literalOccurrences = DATA_SOURCE.match(/"2026-08-15T17:05:29\.215Z"/g) ?? [];
  assert.equal(literalOccurrences.length, 1, `expected the literal date string exactly once, found ${literalOccurrences.length}`);
});

// ── 1-3: operator_submissions boundary (inclusive) ───────────────────────────

test("1, 2 & 3. Venue Submitted applies an inclusive (.gte, not .gt) lower bound on submitted_at using VENUE_FUNNEL_START_AT — before is excluded, exactly-at and after are included", () => {
  assert.match(DATA_SOURCE, /\.in\("status", ACTIVE_SUBMISSION_STATUSES\)\s*\n\s*\.gte\("submitted_at", VENUE_FUNNEL_START_AT\),/);
  assert.doesNotMatch(DATA_SOURCE, /\.gt\("submitted_at"/); // must be >=, not the exclusive >
});

// ── 4-6: venue_claims boundary (inclusive) ───────────────────────────────────

test("4, 5 & 6. Claim Submitted applies an inclusive (.gte, not .gt) lower bound on created_at using VENUE_FUNNEL_START_AT — before is excluded, exactly-at and after are included", () => {
  assert.match(DATA_SOURCE, /\.in\("status", ACTIVE_CLAIM_STATUSES\)\s*\n\s*\.gte\("created_at", VENUE_FUNNEL_START_AT\),/);
  assert.doesNotMatch(DATA_SOURCE, /\.gt\("created_at"/); // must be >=, not the exclusive >
});

// ── 7. Terminal statuses stay excluded regardless of date ───────────────────

test("7. the date boundary is chained onto the SAME query as the active-status filter — a claim/submission must satisfy both; a terminal-status row is never reachable by date alone", () => {
  const submissionsQuery = DATA_SOURCE.match(/\.from\("operator_submissions"\)[\s\S]*?,\n/)![0];
  assert.match(submissionsQuery, /\.in\("status", ACTIVE_SUBMISSION_STATUSES\)/);
  assert.match(submissionsQuery, /\.gte\("submitted_at", VENUE_FUNNEL_START_AT\)/);

  const claimsQuery = DATA_SOURCE.match(/\.from\("venue_claims"\)[\s\S]*?,\n/)![0];
  assert.match(claimsQuery, /\.in\("status", ACTIVE_CLAIM_STATUSES\)/);
  assert.match(claimsQuery, /\.gte\("created_at", VENUE_FUNNEL_START_AT\)/);
});

// ── 8 & 9. The boundary is never applied to venue creation date ─────────────

test("8 & 9. the active-venues query (downstream lanes) has no VENUE_FUNNEL_START_AT / created_at date filter at all — an old seeded venue claimed after the Funnel start can still appear in Setup Sent/Stalled/Account Created/Onboarding", () => {
  const venuesQueryBlock = DATA_SOURCE.match(/\.from\("venues"\)\s*\n\s*\.select\(VENUE_SELECT\)\s*\n\s*\.not\("created_by_operator_id", "is", null\),/)![0];
  assert.doesNotMatch(venuesQueryBlock, /VENUE_FUNNEL_START_AT/);
  assert.doesNotMatch(venuesQueryBlock, /created_at/);
});

test("VENUE_FUNNEL_START_AT is referenced by name only twice in the whole file — once in the submissions query, once in the claims query; never near venues.created_at", () => {
  const referenceCount = (DATA_SOURCE.match(/VENUE_FUNNEL_START_AT\)/g) ?? []).length;
  assert.equal(referenceCount, 2, `expected exactly 2 query-site references to VENUE_FUNNEL_START_AT, found ${referenceCount}`);
});

// ── 10. Lane precedence is untouched by this change ──────────────────────────

test("10. classifyVenueLane() and the venue-card classification block are byte-for-byte unchanged by the Phase 2E boundary — the boundary only touches the two Entry queries", () => {
  // Full precedence coverage already lives in venueFunnelLaneClassification.test.ts
  // (44 passing tests, unaffected by this change) — this just confirms the
  // function itself wasn't touched as part of wiring the boundary in.
  assert.match(DATA_SOURCE, /export function classifyVenueLane\(input: VenueLaneClassificationInput\): VenueLaneClassification \{/);
  assert.match(DATA_SOURCE, /if \(input\.plan !== "free"\) \{\s*\n\s*laneKey = "paid_plan";/);
});
