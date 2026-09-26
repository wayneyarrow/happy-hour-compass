import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-inspection tests for how src/lib/operatorActivation.ts and its four
 * provisionOperatorForVenue() call sites wire in the atomic activation-
 * lifecycle claim (src/lib/activation/activationLifecycle.ts).
 *
 * WHY SOURCE INSPECTION, NOT BEHAVIORAL MOCKS: provisionOperatorForVenue()
 * and completeOperatorAccountActivation() call the real Supabase admin
 * client directly with no dependency-injection seam — the exact same
 * limitation already documented in
 * tests/unit/operatorActivation/operatorActivationObservability.test.ts and
 * tests/unit/venue/additionalVenueVerification.test.ts, both of which use
 * this identical readFileSync + regex-match approach for the same reason.
 * The atomic guarantee itself (the actual race fix) has REAL behavioral
 * tests against an exported, dependency-injectable function — see
 * activationLifecycleClaim.test.ts. These tests only pin that the four call
 * sites invoke it correctly (right timing, right origin, guarded note write).
 */

const OPERATOR_ACTIVATION_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/operatorActivation.ts"),
  "utf8"
);
const CLAIMS_ACTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/claims/[id]/actions.ts"),
  "utf8"
);
const SUBMISSIONS_ACTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/operator-submissions/[id]/actions.ts"),
  "utf8"
);
const OWNER_ACTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/(consumer)/suggest/owner/actions.ts"),
  "utf8"
);

// ── provisionOperatorForVenue() no longer touches activation at all ────────

test("provisionOperatorForVenue's success return no longer carries an `activation` field", () => {
  assert.match(
    OPERATOR_ACTIVATION_SOURCE,
    // Phase 2B added only the optional setupEmailDeferred flag — still no `activation` field.
    /\| \{ ok: true; authUserId: string; setupEmailDeferred\?: true \}\s*\| \{ ok: false; error: string; hhcErrorId\?: string \}/
  );
});

test("provisionOperatorForVenue never imports the removed check-then-act decision helpers", () => {
  assert.doesNotMatch(OPERATOR_ACTIVATION_SOURCE, /decideActivationForProvisioning/);
  assert.doesNotMatch(OPERATOR_ACTIVATION_SOURCE, /getOriginRowActivation/);
  assert.doesNotMatch(OPERATOR_ACTIVATION_SOURCE, /findLiveLifecycleElsewhere/);
});

test("none of the 4 call sites pass an `origin` parameter into provisionOperatorForVenue() — the atomic claim happens separately, after the origin row exists", () => {
  const provisionCallBlock = /provisionOperatorForVenue\(\{[\s\S]{0,400}?\}\);/g;
  for (const source of [CLAIMS_ACTIONS_SOURCE, SUBMISSIONS_ACTIONS_SOURCE, OWNER_ACTIONS_SOURCE]) {
    for (const match of source.matchAll(provisionCallBlock)) {
      assert.doesNotMatch(match[0], /\borigin:/, `unexpected origin param in a provisionOperatorForVenue() call: ${match[0].slice(0, 80)}...`);
    }
  }
});

// ── Each of the 4 call sites invokes the atomic claim, after its own origin-row write ─

test("reviewClaimAction claims the lifecycle AFTER the claim-approved UPDATE succeeds, using the claim as origin", () => {
  const updateIdx = CLAIMS_ACTIONS_SOURCE.indexOf('.update({\n      status:                "approved",');
  const claimCallIdx = CLAIMS_ACTIONS_SOURCE.indexOf("claimOrReuseActivationLifecycle({");
  assert.ok(updateIdx !== -1 && claimCallIdx !== -1 && claimCallIdx > updateIdx);
  const claimCallBlock = CLAIMS_ACTIONS_SOURCE.slice(claimCallIdx, claimCallIdx + 200);
  assert.match(claimCallBlock, /operatorId: provisionResult\.authUserId,/);
  assert.match(claimCallBlock, /origin: \{ type: "claim", claimId \},/);
});

test("approveAndCreateVenueAction and resolveExistingVenueMatchAction each claim the lifecycle with a submission origin", () => {
  const claimCalls = [...SUBMISSIONS_ACTIONS_SOURCE.matchAll(/claimOrReuseActivationLifecycle\(\{[\s\S]{0,300}?\}\);/g)];
  assert.equal(claimCalls.length, 2, "both submission-approval actions must call the atomic claim");
  for (const match of claimCalls) {
    assert.match(match[0], /operatorId: provisionResult\.authUserId,/);
    assert.match(match[0], /origin: \{ type: "submission", submissionId \},/);
  }
});

test("saveOperatorSubmissionAction claims the lifecycle AFTER the submission INSERT succeeds, guarded on operatorId (confirmed_auto only)", () => {
  const insertIdx = OWNER_ACTIONS_SOURCE.indexOf('.from("operator_submissions").insert({');
  const claimGuardIdx = OWNER_ACTIONS_SOURCE.indexOf("if (operatorId) {");
  const claimCallIdx = OWNER_ACTIONS_SOURCE.indexOf("claimOrReuseActivationLifecycle({");
  assert.ok(insertIdx !== -1 && claimGuardIdx !== -1 && claimCallIdx !== -1);
  assert.ok(claimCallIdx > insertIdx, "the atomic claim must run after the submission row is inserted");
  assert.ok(claimGuardIdx < claimCallIdx, "the claim call must be guarded by `if (operatorId)`");
  const claimCallBlock = OWNER_ACTIONS_SOURCE.slice(claimCallIdx, claimCallIdx + 200);
  assert.match(claimCallBlock, /origin: \{ type: "submission", submissionId: insertedSubmission\.id \},/);
});

test("no call site spreads activation columns directly into its own UPDATE/INSERT — the canonical lifecycle table is the only writer", () => {
  for (const source of [CLAIMS_ACTIONS_SOURCE, SUBMISSIONS_ACTIONS_SOURCE, OWNER_ACTIONS_SOURCE]) {
    assert.doesNotMatch(source, /activation_started_at:/, "no call site should write activation_started_at directly");
    assert.doesNotMatch(source, /activation_deadline_at:/, "no call site should write activation_deadline_at directly");
    assert.doesNotMatch(source, /activation_reminder_stage:/, "no call site should write activation_reminder_stage directly");
  }
});

// ── activation_started note only on a genuine "started" decision ───────────

test("each of the 4 call sites writes the activation_started note only when the claim result's decision is 'started', never merely on a truthy value", () => {
  const startedGuardPattern = /if \(lifecycleResult\.decision === "started"\) \{/g;
  const claimGuards = [...CLAIMS_ACTIONS_SOURCE.matchAll(startedGuardPattern)];
  assert.equal(claimGuards.length, 1);
  const submissionGuards = [...SUBMISSIONS_ACTIONS_SOURCE.matchAll(startedGuardPattern)];
  assert.equal(submissionGuards.length, 2);
  const ownerGuards = [...OWNER_ACTIONS_SOURCE.matchAll(startedGuardPattern)];
  assert.equal(ownerGuards.length, 1);
});

test("activation_started note is written to venue_claim_notes for the claim flow, and operator_submission_notes for both submission flows", () => {
  const writeActivationNoteCall = /writeActivationNote\(\{\s*\n\s*origin: \{ type: "(claim|submission)", (?:claimId|submissionId)(?::[^,]+)? \},/g;
  const claimNoteWrites = [...CLAIMS_ACTIONS_SOURCE.matchAll(writeActivationNoteCall)];
  assert.equal(claimNoteWrites.length, 1);
  assert.equal(claimNoteWrites[0][1], "claim");

  const submissionNoteWrites = [...SUBMISSIONS_ACTIONS_SOURCE.matchAll(writeActivationNoteCall)];
  assert.equal(submissionNoteWrites.length, 2);
  for (const match of submissionNoteWrites) assert.equal(match[1], "submission");

  const ownerNoteWrites = [...OWNER_ACTIONS_SOURCE.matchAll(writeActivationNoteCall)];
  assert.equal(ownerNoteWrites.length, 1);
  assert.equal(ownerNoteWrites[0][1], "submission");
});

test("activation_started event metadata contains only a deadline timestamp and a flow label — never a secret-shaped key", () => {
  const forbiddenKeyPattern = /token|password|secret|otp|code|link|auth/i;
  const metadataBlocks = [
    ...CLAIMS_ACTIONS_SOURCE.matchAll(/metadata: \{ ([^}]+) \}/g),
    ...SUBMISSIONS_ACTIONS_SOURCE.matchAll(/metadata: \{ ([^}]+) \}/g),
    ...OWNER_ACTIONS_SOURCE.matchAll(/metadata: \{ ([^}]+) \}/g),
  ].filter((m) => m[1].includes("activationDeadline"));

  assert.ok(metadataBlocks.length >= 4, "expected an activationDeadline metadata block at each of the 4 call sites");
  for (const match of metadataBlocks) {
    const keys = [...match[1].matchAll(/(\w+):/g)].map((k) => k[1]);
    assert.deepEqual(new Set(keys), new Set(["activationDeadline", "flow"]));
    for (const key of keys) {
      assert.doesNotMatch(key, forbiddenKeyPattern, `metadata key "${key}" looks secret-shaped`);
    }
  }
});

// ── Activation completion: authoritative canonical-table lookup ────────────

test("completeOperatorAccountActivation resolves origin via the canonical operator_activation_lifecycles table before falling back to the legacy heuristic", () => {
  const canonicalIdx = OPERATOR_ACTIVATION_SOURCE.indexOf('.from("operator_activation_lifecycles")');
  const legacyCommentIdx = OPERATOR_ACTIVATION_SOURCE.indexOf("Legacy fallback (operators provisioned before migration 098)");
  assert.ok(canonicalIdx !== -1, "the canonical lifecycle-table lookup must exist");
  assert.ok(legacyCommentIdx !== -1, "the legacy fallback path must still exist for pre-migration rows");
  assert.ok(canonicalIdx < legacyCommentIdx, "canonical lookup must run before the legacy fallback");
});

test("completeOperatorAccountActivation's canonical lookup filters to a live lifecycle only (expired_at/released_at IS NULL)", () => {
  const canonicalBlockIdx = OPERATOR_ACTIVATION_SOURCE.indexOf('.from("operator_activation_lifecycles")');
  const block = OPERATOR_ACTIVATION_SOURCE.slice(canonicalBlockIdx, canonicalBlockIdx + 300);
  assert.match(block, /\.is\("expired_at", null\)/);
  assert.match(block, /\.is\("released_at", null\)/);
});

test("completeOperatorAccountActivation writes exactly one structured account_activated event, guarded by claimId or submissionId", () => {
  const eventTypeMatches = [...OPERATOR_ACTIVATION_SOURCE.matchAll(/eventType: "account_activated"/g)];
  assert.equal(eventTypeMatches.length, 1, "account_activated must be written from exactly one call site");
  const guardIdx = OPERATOR_ACTIVATION_SOURCE.indexOf("if (claimId || submissionId) {");
  assert.ok(guardIdx !== -1 && guardIdx < eventTypeMatches[0].index!);
});

test("completeOperatorAccountActivation's structured event write sits after the atomic account_activated_at gate, so a retry never duplicates it", () => {
  const gateIdx = OPERATOR_ACTIVATION_SOURCE.indexOf('.is("account_activated_at", null)');
  const earlyReturnIdx = OPERATOR_ACTIVATION_SOURCE.indexOf("// Already activated (retry, race, or a later password reset) — no-op.");
  const structuredEventIdx = OPERATOR_ACTIVATION_SOURCE.indexOf('eventType: "account_activated"');
  assert.ok(gateIdx !== -1 && earlyReturnIdx !== -1 && structuredEventIdx !== -1);
  assert.ok(gateIdx < earlyReturnIdx && earlyReturnIdx < structuredEventIdx);
});

// ── System-author attribution ───────────────────────────────────────────────

test("structured notes are attributed to the Happy Hour Compass system author, never a real user id", () => {
  const notesSource = readFileSync(
    join(__dirname, "../../../src/lib/activation/activationNotes.ts"),
    "utf8"
  );
  assert.match(notesSource, /export const SYSTEM_AUTHOR_EMAIL = "Happy Hour Compass";/);
  assert.match(notesSource, /created_by: null,/);
  assert.match(notesSource, /created_by_email: SYSTEM_AUTHOR_EMAIL,/);
});

// ── Failure reporting: an unexpected claim failure is never silent ─────────

test("claimOrReuseActivationLifecycle reports an unexpected failure to Sentry + #ops-critical, distinct from the uniqueness-conflict (reused) path", () => {
  const lifecycleSource = readFileSync(
    join(__dirname, "../../../src/lib/activation/activationLifecycle.ts"),
    "utf8"
  );
  assert.match(lifecycleSource, /insertError\?\.code === "23505"/);
  assert.match(lifecycleSource, /channel: "ops-critical"/);
  assert.match(lifecycleSource, /decision: "claim_failed"/);
});
