import { test } from "node:test";
import assert from "node:assert/strict";
import { resendClaimSetupEmailImpl } from "../../../src/app/control-panel/claims/[id]/resendClaimSetupEmailImpl";
import { resendSubmissionSetupEmailImpl } from "../../../src/app/control-panel/operator-submissions/[id]/resendSubmissionSetupEmailImpl";

/**
 * Phase 1C QA correction: staging QA found that BOTH the Claim and
 * Submission standalone "Resend setup email" actions could send a setup
 * email for a record with NO activation lifecycle tracked at all — bypassing
 * the controlled legacy-resume flow ("Start activation tracking & resend
 * setup email") entirely. These tests prove, behaviorally (not just via the
 * pure evaluateClaimResendEligibility/evaluateSubmissionResendEligibility
 * predicates in activationPresentation.test.ts), that a DIRECT invocation of
 * either impl with no lifecycle row present never reaches
 * supabase.auth.admin.generateLink() — the earliest point at which a real
 * email could possibly be sent, since sendPasswordSetupEmail/
 * sendOperatorActivationEmail are only ever called using the link
 * generateLink() returns.
 *
 * NO TEST HERE REACHES THE REAL EMAIL PROVIDER: the fake adminClient's own
 * `auth.admin.generateLink` always returns an error, so even the "eligible"
 * test cases below stop at "we reached generateLink with the right
 * arguments" and never proceed to sendPasswordSetupEmail/
 * sendOperatorActivationEmail (neither of which is behind a DI seam in
 * these impls — see resendClaimSetupEmailAuthorization.test.ts's header for
 * the same reasoning, applied there to the authorization checkpoint instead
 * of this lifecycle-eligibility checkpoint).
 */

type Row = Record<string, unknown>;

function makeTable(getRows: () => Row[], pushRow?: (row: Row) => void) {
  return {
    select() {
      const filters: { col: string; val: unknown }[] = [];
      let orderCol: string | null = null;
      let orderAscending = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return builder;
        },
        in(col: string, vals: unknown[]) {
          const rows = getRows().filter((r) => vals.includes(r[col]));
          return Promise.resolve({ data: rows, error: null });
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderCol = col;
          orderAscending = opts?.ascending !== false;
          return builder;
        },
        limit(n: number) {
          let rows = getRows().filter((r) => filters.every((f) => r[f.col] === f.val));
          if (orderCol) {
            const col = orderCol;
            rows = [...rows].sort((a, b) => {
              const av = a[col] as string;
              const bv = b[col] as string;
              return orderAscending ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
            });
          }
          return Promise.resolve({ data: rows.slice(0, n), error: null });
        },
        single: async () => {
          const rows = getRows().filter((r) => filters.every((f) => r[f.col] === f.val));
          if (rows.length !== 1) return { data: null, error: { message: "not found" } };
          return { data: rows[0], error: null };
        },
        maybeSingle: async () => {
          const rows = getRows().filter((r) => filters.every((f) => r[f.col] === f.val));
          return { data: rows[0] ?? null, error: null };
        },
      };
      return builder;
    },
    insert: async (row: Row) => {
      pushRow?.(row);
      return { data: row, error: null };
    },
  };
}

function fakeAuthClient(user: { id: string; email: string } | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { auth: { getUser: async () => ({ data: { user } }) } } as any;
}

const FOUNDER = { id: "founder-1", email: "founder@happyhourcompass.com" };
const FAR_FUTURE_DEADLINE = "2099-01-01T00:00:00.000Z";

function makeResendWorld(seed: {
  venueClaims?: Row[];
  operatorSubmissions?: Row[];
  venues?: Row[];
  operators?: Row[];
  lifecycles?: Row[];
}) {
  const state = {
    venueClaims: seed.venueClaims ?? [],
    operatorSubmissions: seed.operatorSubmissions ?? [],
    venues: seed.venues ?? [],
    operators: seed.operators ?? [],
    lifecycles: seed.lifecycles ?? [],
    venueClaimNotes: [] as Row[],
    operatorSubmissionNotes: [] as Row[],
  };

  let generateLinkCallCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let generateLinkArgs: any = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      switch (table) {
        case "venue_claims":
          return makeTable(() => state.venueClaims);
        case "operator_submissions":
          return makeTable(() => state.operatorSubmissions);
        case "venues":
          return makeTable(() => state.venues);
        case "operators":
          return makeTable(() => state.operators);
        case "operator_activation_lifecycles":
          return makeTable(() => state.lifecycles);
        case "venue_claim_notes":
          return makeTable(
            () => state.venueClaimNotes,
            (row) => state.venueClaimNotes.push(row)
          );
        case "operator_submission_notes":
          return makeTable(
            () => state.operatorSubmissionNotes,
            (row) => state.operatorSubmissionNotes.push(row)
          );
        default:
          throw new Error(`unexpected table in fake: ${table}`);
      }
    },
    auth: {
      admin: {
        // Intentionally ALWAYS fails — this test suite never needs a real
        // link or to reach the real email provider. Reaching this call at
        // all (regardless of its result) is exactly the behavior these
        // tests are proving/disproving.
        generateLink: async (args: unknown) => {
          generateLinkCallCount++;
          generateLinkArgs = args;
          return { data: null, error: { message: "stubbed — never reaches a real provider" } };
        },
      },
    },
  };

  return {
    client,
    wasGenerateLinkCalled: () => generateLinkCallCount > 0,
    generateLinkArgs: () => generateLinkArgs,
  };
}

// ── Claims ───────────────────────────────────────────────────────────────────

test("resendClaimSetupEmailImpl: a claim with NO activation lifecycle row sends no email — generateLink is never reached", async () => {
  const { client, wasGenerateLinkCalled } = makeResendWorld({
    venueClaims: [{ id: "claim-1", email: "marnie@example.com", first_name: "Marnie", venue_id: "venue-1", status: "approved" }],
    venues: [{ id: "venue-1", claimed_by: "op-1", created_by_operator_id: "op-1" }],
    operators: [{ id: "op-1", email: "marnie@example.com", account_activated_at: null, first_name: "Marnie", last_name: null }],
    lifecycles: [], // ← the actual staging QA bug: no lifecycle row at all
  });

  const result = await resendClaimSetupEmailImpl("claim-1", {
    authClient: fakeAuthClient(FOUNDER),
    checkAdmin: async () => true,
    adminClient: client,
  });

  assert.equal(result.success, undefined);
  assert.match(result.error ?? "", /No activation lifecycle is tracked/);
  assert.equal(wasGenerateLinkCalled(), false, "no lifecycle must mean no email is ever attempted");
});

test("resendClaimSetupEmailImpl: a claim WITH a live lifecycle proceeds past eligibility and reaches generateLink — existing behavior still works", async () => {
  const { client, wasGenerateLinkCalled, generateLinkArgs } = makeResendWorld({
    venueClaims: [{ id: "claim-2", email: "dan@example.com", first_name: "Dan", venue_id: "venue-2", status: "approved" }],
    venues: [{ id: "venue-2", claimed_by: "op-2", created_by_operator_id: "op-2" }],
    operators: [{ id: "op-2", email: "dan@example.com", account_activated_at: null, first_name: "Dan", last_name: null }],
    lifecycles: [
      {
        id: "lc-2",
        operator_id: "op-2",
        origin_type: "claim",
        origin_claim_id: "claim-2",
        origin_submission_id: null,
        started_at: "2026-06-01T00:00:00.000Z",
        deadline_at: FAR_FUTURE_DEADLINE,
        reminder_stage: 0,
        expired_at: null,
        released_at: null,
      },
    ],
  });

  const result = await resendClaimSetupEmailImpl("claim-2", {
    authClient: fakeAuthClient(FOUNDER),
    checkAdmin: async () => true,
    adminClient: client,
  });

  // The only failure here is the deliberately-stubbed generateLink — proving
  // eligibility passed and execution reached the link-generation step.
  assert.equal(result.success, undefined);
  assert.match(result.error ?? "", /Failed to generate a new setup link/);
  assert.equal(wasGenerateLinkCalled(), true, "a live lifecycle must still allow resend to proceed");
  assert.equal(generateLinkArgs()?.email, "dan@example.com");
});

// ── Submissions ──────────────────────────────────────────────────────────────

test("resendSubmissionSetupEmailImpl: a submission with NO activation lifecycle row sends no email — generateLink is never reached", async () => {
  const { client, wasGenerateLinkCalled } = makeResendWorld({
    operatorSubmissions: [
      { id: "sub-1", email: "kelly@example.com", first_name: "Kelly", operator_id: "op-3", status: "confirmed_auto", venue_id: "venue-3" },
    ],
    venues: [{ id: "venue-3", claimed_by: "op-3", created_by_operator_id: "op-3" }],
    operators: [{ id: "op-3", email: "kelly@example.com", account_activated_at: null, first_name: "Kelly", last_name: null }],
    lifecycles: [], // ← the actual staging QA bug: no lifecycle row at all
  });

  const result = await resendSubmissionSetupEmailImpl("sub-1", {
    authClient: fakeAuthClient(FOUNDER),
    checkAdmin: async () => true,
    adminClient: client,
  });

  assert.equal(result.success, undefined);
  assert.match(result.error ?? "", /No activation lifecycle is tracked/);
  assert.equal(wasGenerateLinkCalled(), false, "no lifecycle must mean no email is ever attempted");
});

test("resendSubmissionSetupEmailImpl: a submission WITH a live lifecycle proceeds past eligibility and reaches generateLink — existing behavior still works", async () => {
  const { client, wasGenerateLinkCalled, generateLinkArgs } = makeResendWorld({
    operatorSubmissions: [
      { id: "sub-2", email: "returning@example.com", first_name: "Returning", operator_id: "op-4", status: "confirmed_auto", venue_id: "venue-4" },
    ],
    venues: [{ id: "venue-4", claimed_by: "op-4", created_by_operator_id: "op-4" }],
    operators: [{ id: "op-4", email: "returning@example.com", account_activated_at: null, first_name: "Returning", last_name: null }],
    lifecycles: [
      {
        id: "lc-4",
        operator_id: "op-4",
        origin_type: "submission",
        origin_claim_id: null,
        origin_submission_id: "sub-2",
        started_at: "2026-06-01T00:00:00.000Z",
        deadline_at: FAR_FUTURE_DEADLINE,
        reminder_stage: 0,
        expired_at: null,
        released_at: null,
      },
    ],
  });

  const result = await resendSubmissionSetupEmailImpl("sub-2", {
    authClient: fakeAuthClient(FOUNDER),
    checkAdmin: async () => true,
    adminClient: client,
  });

  assert.equal(result.success, undefined);
  assert.match(result.error ?? "", /Failed to generate a new setup link/);
  assert.equal(wasGenerateLinkCalled(), true, "a live lifecycle must still allow resend to proceed");
  assert.equal(generateLinkArgs()?.email, "returning@example.com");
});

test("resendSubmissionSetupEmailImpl: a released lifecycle is blocked before generateLink", async () => {
  const { client, wasGenerateLinkCalled } = makeResendWorld({
    operatorSubmissions: [
      { id: "sub-3", email: "released@example.com", first_name: "R", operator_id: "op-5", status: "confirmed_auto", venue_id: "venue-5" },
    ],
    venues: [{ id: "venue-5", claimed_by: "op-5", created_by_operator_id: "op-5" }],
    operators: [{ id: "op-5", email: "released@example.com", account_activated_at: null, first_name: "R", last_name: null }],
    lifecycles: [
      {
        id: "lc-5",
        operator_id: "op-5",
        origin_type: "submission",
        origin_claim_id: null,
        origin_submission_id: "sub-3",
        started_at: "2026-06-01T00:00:00.000Z",
        deadline_at: "2026-06-20T00:00:00.000Z",
        reminder_stage: 0,
        expired_at: "2026-06-21T00:00:00.000Z",
        released_at: "2026-06-22T00:00:00.000Z",
      },
    ],
  });

  const result = await resendSubmissionSetupEmailImpl("sub-3", {
    authClient: fakeAuthClient(FOUNDER),
    checkAdmin: async () => true,
    adminClient: client,
  });

  assert.match(result.error ?? "", /already been released/);
  assert.equal(wasGenerateLinkCalled(), false);
});

test("resendClaimSetupEmailImpl: an overdue (release_required) lifecycle is blocked before generateLink — must extend first", async () => {
  const { client, wasGenerateLinkCalled } = makeResendWorld({
    venueClaims: [{ id: "claim-3", email: "overdue@example.com", first_name: "O", venue_id: "venue-6", status: "approved" }],
    venues: [{ id: "venue-6", claimed_by: "op-6", created_by_operator_id: "op-6" }],
    operators: [{ id: "op-6", email: "overdue@example.com", account_activated_at: null, first_name: "O", last_name: null }],
    lifecycles: [
      {
        id: "lc-6",
        operator_id: "op-6",
        origin_type: "claim",
        origin_claim_id: "claim-3",
        origin_submission_id: null,
        started_at: "2020-01-01T00:00:00.000Z",
        deadline_at: "2020-01-15T00:00:00.000Z", // long past
        reminder_stage: 0,
        expired_at: null,
        released_at: null,
      },
    ],
  });

  const result = await resendClaimSetupEmailImpl("claim-3", {
    authClient: fakeAuthClient(FOUNDER),
    checkAdmin: async () => true,
    adminClient: client,
  });

  assert.match(result.error ?? "", /deadline has already passed/);
  assert.equal(wasGenerateLinkCalled(), false);
});
