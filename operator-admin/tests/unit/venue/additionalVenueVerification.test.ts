import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAdditionalVenueInsertPayload } from "../../../src/lib/venueActions";

/**
 * Coverage for the additional-venue verification gap fix: an already-
 * activated operator creating a second-or-later venue via
 * createVenueAdminAction() (src/app/admin/venue/actions.ts) must now
 * receive is_verified = true, the same way provisionOperatorForVenue()
 * (src/lib/operatorActivation.ts) sets it for a venue's first operator.
 *
 * buildAdditionalVenueInsertPayload() (src/lib/venueActions.ts) is a pure
 * extraction of the exact INSERT payload — see its own doc comment for why
 * it exists as a pure function at all: createVenueAdminAction() itself has
 * no DI seam (resolveOperatorContext() + a real Supabase client), so —
 * matching this repo's established convention for that class of function
 * (see tests/unit/venue/cancelVenueActionRegression.test.ts and
 * tests/unit/operatorActivation/operatorActivationObservability.test.ts) —
 * the DB-agnostic decision logic is what gets a real unit test, and the
 * action's own wiring/ownership gate is verified as a static, structural
 * check of its actual source below.
 */

// ── 1, 2, 3: additional-venue creation gets the correct canonical state ────

test("an already-activated operator's additional venue is created is_verified = true", () => {
  const payload = buildAdditionalVenueInsertPayload({
    operatorId: "op-123",
    name: "Second Venue",
    slug: "second-venue-abcde",
  });
  assert.equal(payload.is_verified, true);
});

test("the additional venue remains associated with exactly the operator that created it", () => {
  const payload = buildAdditionalVenueInsertPayload({
    operatorId: "op-123",
    name: "Second Venue",
    slug: "second-venue-abcde",
  });
  assert.equal(payload.created_by_operator_id, "op-123");
  assert.equal(payload.updated_by_operator_id, "op-123");
});

test("payload carries only the expected fields — no extra client-influenceable fields", () => {
  const payload = buildAdditionalVenueInsertPayload({
    operatorId: "op-123",
    name: "Second Venue",
    slug: "second-venue-abcde",
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    "created_by_operator_id",
    "is_verified",
    "name",
    "slug",
    "updated_by_operator_id",
  ]);
});

test("a different operator id always produces that operator's own payload — never a fixed/wrong id", () => {
  const a = buildAdditionalVenueInsertPayload({ operatorId: "op-A", name: "Venue A", slug: "venue-a" });
  const b = buildAdditionalVenueInsertPayload({ operatorId: "op-B", name: "Venue B", slug: "venue-b" });
  assert.equal(a.created_by_operator_id, "op-A");
  assert.equal(b.created_by_operator_id, "op-B");
  assert.notEqual(a.created_by_operator_id, b.created_by_operator_id);
});

// ── 4: unrelated venue cannot be verified through this flow ────────────────
//
// buildAdditionalVenueInsertPayload() has no venue-id parameter at all — it
// only ever describes a brand-new row to INSERT, never a target to UPDATE.
// There is structurally no way to point it at an existing/unrelated venue.
// This is confirmed at the type level (a `venueId`/`id` argument would be a
// compile error) and re-confirmed as a source-text property below.

test("buildAdditionalVenueInsertPayload's parameter shape has no venue-id-like field to target an existing venue", () => {
  const payload = buildAdditionalVenueInsertPayload({
    operatorId: "op-123",
    name: "Second Venue",
    slug: "second-venue-abcde",
  });
  // The payload itself never carries an "id" — Postgres assigns one on
  // INSERT (see venues.id's DEFAULT gen_random_uuid(), migration 001).
  assert.equal("id" in payload, false);
});

// ── Structural verification of createVenueAdminAction() itself ─────────────
//
// createVenueAdminAction() calls resolveOperatorContext()/a real Supabase
// client with no DI seam — same reasoning as cancelVenueActionRegression.test.ts
// — so its wiring is verified as a static property of its actual source.

const ACTIONS_SOURCE = readFileSync(join(__dirname, "../../../src/app/admin/venue/actions.ts"), "utf8");

function createVenueAdminActionBody(): string {
  const start = ACTIONS_SOURCE.indexOf("export async function createVenueAdminAction");
  const end = ACTIONS_SOURCE.indexOf("\n// ───", start + 1);
  return ACTIONS_SOURCE.slice(start, end === -1 ? undefined : end);
}

test("createVenueAdminAction rejects Case B (orphan/no-operator) impersonation before any insert", () => {
  const body = createVenueAdminActionBody();
  const guardIdx = body.indexOf("if (!ctx.operator)");
  const insertIdx = body.indexOf(".insert(");
  assert.ok(guardIdx !== -1, "the !ctx.operator guard must still exist");
  assert.ok(insertIdx !== -1, "the insert call must still exist");
  assert.ok(guardIdx < insertIdx, "the operator guard must run BEFORE the insert — never the reverse");
});

test("createVenueAdminAction builds the insert payload from ctx.operator.id (server-resolved), never from client formData", () => {
  const body = createVenueAdminActionBody();
  // The only value read from the client is the venue name; operatorId is
  // wired from ctx.operator.id, not formData.
  assert.match(body, /buildAdditionalVenueInsertPayload\(\{\s*operatorId:\s*ctx\.operator\.id,/);
  // formData.get(...) is used only for "name" in this action — never for
  // an operator/venue identifier.
  const formDataReads = [...body.matchAll(/formData\.get\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(formDataReads, ["name"]);
});

test("createVenueAdminAction never passes a venue id to the insert — it can only ever create a new row", () => {
  const body = createVenueAdminActionBody();
  assert.doesNotMatch(body, /\.eq\("id"/, "createVenueAdminAction must never scope by an existing venue id");
});

// ── 5, 6: existing claim / operator-submission approval paths unchanged ────
//
// This fix does not touch provisionOperatorForVenue() (src/lib/operatorActivation.ts)
// at all — it is the shared function BOTH app/control-panel/claims/[id]/actions.ts
// (claim approval) and app/control-panel/operator-submissions/[id]/actions.ts
// (operator-submission approval) call. Confirming its atomic
// claimed_by/claimed_at/created_by_operator_id/is_verified UPDATE is still
// exactly intact regression-proves both approval paths unchanged, without
// needing to touch either call site's own code (same no-DI-seam class of
// function as createVenueAdminAction — see this file's header).

const OPERATOR_ACTIVATION_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/operatorActivation.ts"),
  "utf8"
);

test("provisionOperatorForVenue's venue-link UPDATE still sets is_verified: true atomically with created_by_operator_id", () => {
  const updateBlock = OPERATOR_ACTIVATION_SOURCE.match(
    /\.from\("venues"\)\s*\.update\(\{[\s\S]*?\}\)\s*\.eq\("id", venueId\);/
  );
  assert.ok(updateBlock, "the venue-link UPDATE block must still exist, unchanged in shape");
  assert.match(updateBlock![0], /claimed_by:\s*authUserId/);
  assert.match(updateBlock![0], /claimed_at:\s*now/);
  assert.match(updateBlock![0], /created_by_operator_id:\s*authUserId/);
  assert.match(updateBlock![0], /is_verified:\s*true/);
});

test("both claim approval and operator-submission approval call the shared provisionOperatorForVenue()", () => {
  const claimsActions = readFileSync(
    join(__dirname, "../../../src/app/control-panel/claims/[id]/actions.ts"),
    "utf8"
  );
  const submissionsActions = readFileSync(
    join(__dirname, "../../../src/app/control-panel/operator-submissions/[id]/actions.ts"),
    "utf8"
  );
  assert.match(claimsActions, /provisionOperatorForVenue/);
  assert.match(submissionsActions, /provisionOperatorForVenue/);
});
