// Must be first: routes external boundaries to in-process fakes.
import "./support/installBoundaryFakes";

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { world, resetWorld } from "./support/world";
import { reviewClaimAction, addClaimNoteAction } from "../../../src/app/control-panel/claims/[id]/actions";

/**
 * AUTHORIZATION — Control Panel claim actions.
 *
 * reviewClaimAction and addClaimNoteAction used to check only that SOME user
 * was signed in. Server action IDs ship in public JavaScript, so any
 * signed-in consumer or operator could have approved, rejected, or annotated
 * claims. These tests run the REAL actions and the REAL isControlPanelAdmin()
 * (platform_admins lookup + env allowlist) against the in-process world
 * (support/world.ts) — no real database, email, or Slack is reachable.
 *
 * The unauthorized cases snapshot the ENTIRE world before and after, so any
 * privileged side effect — a claim/venue/operator write, a lifecycle, an
 * auth user, a note, an audit row, an email, a Slack post, a link — fails
 * the test.
 */

const CLAIM_ID = "00000000-0000-4000-8000-00000000c1a1";
const VENUE_ID = "00000000-0000-4000-8000-00000000ve01";
const ADMIN = { id: "00000000-0000-4000-8000-0000000ad001", email: "founder@fixture.example" };
const CONSUMER = { id: "00000000-0000-4000-8000-0000000c0001", email: "consumer@fixture.example" };
const OPERATOR = { id: "00000000-0000-4000-8000-00000000op01", email: "operator@fixture.example" };
const INACTIVE_ADMIN = { id: "00000000-0000-4000-8000-0000000ad002", email: "former-admin@fixture.example" };

function seed() {
  resetWorld();
  delete process.env.CONTROL_PANEL_ADMIN_EMAILS;
  delete process.env.OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED;
  process.env.NEXT_PUBLIC_SITE_URL = "https://staging.fixture.example";
  process.env.RESEND_API_KEY = "re_fixture_not_a_real_key";

  world.authUsers.push(
    { id: ADMIN.id, email: ADMIN.email },
    { id: CONSUMER.id, email: CONSUMER.email },
    { id: OPERATOR.id, email: OPERATOR.email },
    { id: INACTIVE_ADMIN.id, email: INACTIVE_ADMIN.email }
  );
  world.tables.platform_admins = [
    { id: "pa-1", email: ADMIN.email, status: "active" },
    { id: "pa-2", email: INACTIVE_ADMIN.email, status: "inactive" },
  ];
  world.tables.operators.push({ id: OPERATOR.id, email: OPERATOR.email, account_activated_at: "2026-09-01T00:00:00.000Z" });
  world.tables.venues.push({
    id: VENUE_ID,
    name: "Fixture Claim Venue",
    is_published: true,
    claimed_at: null,
    claimed_by: null,
    created_by_operator_id: null,
    is_verified: false,
  });
  world.tables.venue_claims.push({
    id: CLAIM_ID,
    venue_id: VENUE_ID,
    first_name: "Claimant",
    last_name: "Fixture",
    position: "Manager",
    phone: "(250) 555-0100",
    email: "claimant@fixture.example",
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
  });
}

beforeEach(seed);

function signInAs(user: { id: string } | null) {
  world.sessionUserId = user?.id ?? null;
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Everything a privileged action could change or send. */
function snapshot() {
  return JSON.stringify({
    tables: world.tables,
    authUsers: world.authUsers,
    emails: world.emails,
    slack: world.slack,
    createUserCalls: world.createUserCalls,
    generateLinkCalls: world.generateLinkCalls,
    rpcCalls: world.rpcCalls,
  });
}

const DENIED: { label: string; user: { id: string } | null; expected: string }[] = [
  { label: "unauthenticated caller", user: null, expected: "Session expired. Please sign in again." },
  { label: "signed-in consumer", user: CONSUMER, expected: "Unauthorized." },
  { label: "signed-in operator", user: OPERATOR, expected: "Unauthorized." },
  { label: "signed-in inactive (former) admin", user: INACTIVE_ADMIN, expected: "Unauthorized." },
];

// ── reviewClaimAction ────────────────────────────────────────────────────────

for (const { label, user, expected } of DENIED) {
  for (const action of ["approve", "reject", "needs_more_info"] as const) {
    test(`reviewClaimAction(${action}): ${label} is denied with zero privileged side effects`, async () => {
      signInAs(user);
      const before = snapshot();
      const result = await reviewClaimAction(CLAIM_ID, {}, form({ action }));
      assert.deepEqual(result, { error: expected });
      assert.equal(snapshot(), before, "nothing was written, created, emailed, or posted");
      // Spelled out for the record:
      assert.equal(world.tables.venue_claims[0].status, "pending");
      assert.equal(world.tables.venues[0].claimed_by, null);
      assert.equal(world.createUserCalls.length, 0, "no operator provisioning");
      assert.equal(world.tables.operator_activation_lifecycles.length, 0, "no lifecycle");
      assert.equal(world.emails.length + world.slack.length, 0, "no email, no Slack");
      assert.equal(world.tables.venue_claim_notes.length, 0, "no note");
    });
  }
}

test("reviewClaimAction: an authorized admin can still APPROVE — the existing approval behaviour runs unchanged", async () => {
  signInAs(ADMIN);
  const result = await reviewClaimAction(CLAIM_ID, {}, form({ action: "approve" }));
  assert.deepEqual(result, { success: true, successAction: "Approved — password setup email sent" });
  const claim = world.tables.venue_claims[0];
  assert.equal(claim.status, "approved");
  assert.equal(claim.reviewed_by, ADMIN.id);
  const claimant = world.authUsers.find((u) => u.email === "claimant@fixture.example")!;
  assert.ok(claimant, "claimant provisioned");
  assert.equal(world.tables.venues[0].claimed_by, claimant.id);
  assert.equal(world.tables.operator_activation_lifecycles.length, 1);
  assert.equal(world.tables.operator_activation_lifecycles[0].origin_claim_id, CLAIM_ID);
  // Flag off here → the unchanged legacy setup email.
  const toClaimant = world.emails.filter((e) => e.to === "claimant@fixture.example");
  assert.equal(toClaimant.length, 1);
  assert.match(toClaimant[0].subject, /claim was approved — set up your password/);
});

test("reviewClaimAction: an authorized admin can still REJECT", async () => {
  signInAs(ADMIN);
  const result = await reviewClaimAction(CLAIM_ID, {}, form({ action: "reject" }));
  assert.deepEqual(result, { success: true, successAction: "Rejected" });
  assert.equal(world.tables.venue_claims[0].status, "rejected");
  assert.equal(world.createUserCalls.length, 0);
});

test("reviewClaimAction: an authorized admin can still REQUEST MORE INFO", async () => {
  signInAs(ADMIN);
  const result = await reviewClaimAction(CLAIM_ID, {}, form({ action: "needs_more_info" }));
  assert.equal(result.success, true);
  assert.equal(world.tables.venue_claims[0].status, "needs_more_info");
  assert.equal(world.emails.filter((e) => e.to === "claimant@fixture.example").length, 1);
});

test("reviewClaimAction: the env-var admin allowlist (existing emergency fallback) still authorizes", async () => {
  world.tables.platform_admins = [];
  process.env.CONTROL_PANEL_ADMIN_EMAILS = ADMIN.email;
  signInAs(ADMIN);
  const result = await reviewClaimAction(CLAIM_ID, {}, form({ action: "reject" }));
  assert.equal(result.success, true);
});

test("reviewClaimAction: an invalid action is still rejected before authorization (unchanged)", async () => {
  signInAs(CONSUMER);
  const before = snapshot();
  assert.deepEqual(await reviewClaimAction(CLAIM_ID, {}, form({ action: "delete" })), { error: "Invalid action. Please try again." });
  assert.equal(snapshot(), before);
});

// ── addClaimNoteAction ───────────────────────────────────────────────────────

for (const { label, user, expected } of DENIED) {
  test(`addClaimNoteAction: ${label} is denied and no note is written`, async () => {
    signInAs(user);
    const before = snapshot();
    const result = await addClaimNoteAction(CLAIM_ID, {}, form({ note: "Injected note" }));
    assert.deepEqual(result, { error: expected });
    assert.equal(snapshot(), before);
    assert.equal(world.tables.venue_claim_notes.length, 0);
  });
}

test("addClaimNoteAction: an authorized admin can still add a note, attributed to them", async () => {
  signInAs(ADMIN);
  const result = await addClaimNoteAction(CLAIM_ID, {}, form({ note: "Spoke to the owner by phone." }));
  assert.deepEqual(result, { success: true });
  assert.equal(world.tables.venue_claim_notes.length, 1);
  assert.equal(world.tables.venue_claim_notes[0].note, "Spoke to the owner by phone.");
  assert.equal(world.tables.venue_claim_notes[0].created_by, ADMIN.id);
});

test("addClaimNoteAction: empty-note validation is unchanged", async () => {
  signInAs(ADMIN);
  assert.deepEqual(await addClaimNoteAction(CLAIM_ID, {}, form({ note: "   " })), { fieldError: "Note cannot be empty." });
});
