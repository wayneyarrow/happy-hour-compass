import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resumeLegacyClaimActivationImpl,
  resumeLegacySubmissionActivationImpl,
} from "../../../src/lib/activation/legacyActivationResumeImpl";

/**
 * Full behavioral tests for the Phase 1C controlled legacy-activation-resume
 * implementation — exercising the real authorization → eligibility →
 * atomic-claim → email → note sequence against a fake, in-memory Supabase
 * client. No real Supabase project, no real Resend/Slack call, no real
 * email is ever touched: `deps.sendSetupEmail` replaces the real
 * sendPasswordSetupEmail/sendOperatorActivationEmail entirely for every test
 * here (see legacyActivationResumeImpl.ts's LegacyActivationResumeDeps for
 * why this specific seam exists — this codebase has no other way to
 * guarantee zero real email sends while still testing "exactly one email
 * attempt").
 *
 * WHY THIS TESTS THE IMPL, NOT THE EXPORTED ACTIONS: the two exported
 * Server Actions (legacyActivationResumeActions.ts) have fixed, client-safe
 * signatures — `(id, prevState, formData)` — with no dependency-override
 * parameter, matching the corrected Phase 1B pattern. The
 * LegacyActivationResumeDeps DI seam lives entirely on the impl functions
 * tested here, a plain module with no "use server" directive — never itself
 * network-reachable.
 */

type Row = Record<string, unknown>;

type LifecycleStore = { rows: Row[]; nextId: number };

function makeLifecycleTable(store: LifecycleStore) {
  return {
    select(_cols?: string) {
      const filters: { col: string; val: unknown; op: "eq" | "is" }[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        eq(col: string, val: unknown) {
          filters.push({ col, val, op: "eq" });
          return builder;
        },
        is(col: string, val: unknown) {
          filters.push({ col, val, op: "is" });
          return builder;
        },
        maybeSingle: async () => {
          const match = store.rows.find((r) => filters.every((f) => r[f.col] === f.val));
          return { data: match ?? null, error: null };
        },
      };
      return builder;
    },
    insert(payload: Row) {
      return {
        select() {
          return {
            single: async () => {
              const operatorId = payload.operator_id;
              const claimId = payload.origin_claim_id ?? null;
              const submissionId = payload.origin_submission_id ?? null;
              const conflict = store.rows.some(
                (r) =>
                  (r.operator_id === operatorId && r.expired_at == null && r.released_at == null) ||
                  (claimId !== null && r.origin_claim_id === claimId) ||
                  (submissionId !== null && r.origin_submission_id === submissionId)
              );
              if (conflict) {
                return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
              }
              const row: Row = {
                id: `lc-${store.nextId++}`,
                expired_at: null,
                released_at: null,
                reminder_stage: 0,
                ...payload,
              };
              store.rows.push(row);
              return { data: row, error: null };
            },
          };
        },
      };
    },
  };
}

function makeEqMaybeSingleTable(rows: Row[]) {
  return {
    select(_cols?: string) {
      const filters: { col: string; val: unknown }[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return builder;
        },
        maybeSingle: async () => {
          const match = rows.find((r) => filters.every((f) => r[f.col] === f.val));
          return { data: match ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

type World = {
  operators: Row[];
  claims: Row[];
  submissions: Row[];
  venues: Row[];
  lifecycles: LifecycleStore;
  notes: Row[];
  generateLinkOk: boolean;
};

type WorldOverrides = {
  operators?: Row[];
  claims?: Row[];
  submissions?: Row[];
  venues?: Row[];
  lifecycles?: Row[];
  generateLinkOk?: boolean;
};

function makeWorld(overrides: WorldOverrides = {}) {
  const world: World = {
    operators: overrides.operators ?? [],
    claims: overrides.claims ?? [],
    submissions: overrides.submissions ?? [],
    venues: overrides.venues ?? [],
    lifecycles: { rows: [...(overrides.lifecycles ?? [])], nextId: 1 },
    notes: [],
    generateLinkOk: overrides.generateLinkOk ?? true,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      switch (table) {
        case "operators":
          return makeEqMaybeSingleTable(world.operators);
        case "venue_claims":
          return makeEqMaybeSingleTable(world.claims);
        case "operator_submissions":
          return makeEqMaybeSingleTable(world.submissions);
        case "venues":
          return makeEqMaybeSingleTable(world.venues);
        case "operator_activation_lifecycles":
          return makeLifecycleTable(world.lifecycles);
        case "venue_claim_notes":
        case "operator_submission_notes":
          return {
            insert: async (row: Row) => {
              world.notes.push({ table, ...row });
              return { error: null };
            },
          };
        default:
          throw new Error(`unexpected table in fake: ${table}`);
      }
    },
    auth: {
      admin: {
        generateLink: async () =>
          world.generateLinkOk
            ? { data: { properties: { action_link: "https://staging.example.com/fake-setup-link" } }, error: null }
            : { data: null, error: { message: "simulated generateLink failure" } },
      },
    },
  };

  return { client, world };
}

const FOUNDER = { id: "founder-1", email: "founder@happyhourcompass.com" };
const NON_FOUNDER = { id: "user-1", email: "operator@example.com" };

function authDeps(user: { id: string; email: string } | null, isAdmin: boolean) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authClient: { auth: { getUser: async () => ({ data: { user } }) } } as any,
    checkAdmin: async () => isAdmin,
  };
}

function makeEmailSpy(result: { ok: boolean; error?: string } = { ok: true }) {
  const calls: { to: string; firstName: string; setupLink: string }[] = [];
  const fn = async (args: { to: string; firstName: string; setupLink: string }) => {
    calls.push(args);
    return result;
  };
  return { fn, calls };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function cleanClaimWorld(overrides: WorldOverrides = {}) {
  return makeWorld({
    operators: [{ id: "op-1", account_activated_at: null, first_name: "Marnie", last_name: null, email: "marnie@el-taquero.com" }],
    claims: [{ id: "claim-1", status: "approved", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", claimed_by: "op-1", created_by_operator_id: "op-1" }],
    ...overrides,
  });
}

function cleanSubmissionWorld(status: "confirmed_auto" | "approved" = "approved", overrides: WorldOverrides = {}) {
  return makeWorld({
    operators: [{ id: "op-2", account_activated_at: null, first_name: "Dave", last_name: null, email: "dave@golfbc.com" }],
    submissions: [{ id: "sub-1", status, operator_id: "op-2", venue_id: "venue-2" }],
    venues: [{ id: "venue-2", claimed_by: "op-2", created_by_operator_id: "op-2" }],
    ...overrides,
  });
}

// ── Eligible cases: started ──────────────────────────────────────────────────

test("resumeLegacyClaimActivationImpl: eligible approved Claim → started, exactly one email, exactly one note", async () => {
  const { client, world } = cleanClaimWorld();
  const email = makeEmailSpy();

  const result = await resumeLegacyClaimActivationImpl("claim-1", {
    ...authDeps(FOUNDER, true),
    adminClient: client,
    sendSetupEmail: email.fn,
  });

  assert.equal(result.success, true);
  assert.equal(world.lifecycles.rows.length, 1);
  assert.equal(world.lifecycles.rows[0].origin_claim_id, "claim-1");
  assert.equal(email.calls.length, 1);
  assert.equal(email.calls[0].to, "marnie@el-taquero.com");
  assert.equal(world.notes.length, 1);
  assert.equal(world.notes[0].event_type, "legacy_activation_resumed");
  assert.equal(world.notes[0].created_by_email, FOUNDER.email);
});

test("resumeLegacySubmissionActivationImpl: eligible founder-approved Submission → started, exactly one email, exactly one note", async () => {
  const { client, world } = cleanSubmissionWorld("approved");
  const email = makeEmailSpy();

  const result = await resumeLegacySubmissionActivationImpl("sub-1", {
    ...authDeps(FOUNDER, true),
    adminClient: client,
    sendSetupEmail: email.fn,
  });

  assert.equal(result.success, true);
  assert.equal(world.lifecycles.rows.length, 1);
  assert.equal(email.calls.length, 1);
  assert.equal(world.notes.length, 1);
});

test("resumeLegacySubmissionActivationImpl: eligible confirmed_auto Submission → started, exactly one email, exactly one note", async () => {
  const { client, world } = cleanSubmissionWorld("confirmed_auto");
  const email = makeEmailSpy();

  const result = await resumeLegacySubmissionActivationImpl("sub-1", {
    ...authDeps(FOUNDER, true),
    adminClient: client,
    sendSetupEmail: email.fn,
  });

  assert.equal(result.success, true);
  assert.equal(world.lifecycles.rows.length, 1);
  assert.equal(email.calls.length, 1);
  assert.equal(world.notes.length, 1);
});

// ── Authorization ────────────────────────────────────────────────────────────

test("resumeLegacyClaimActivationImpl: non-founder is denied before any claim/operator/venue lookup", async () => {
  const { client, world } = cleanClaimWorld();
  const email = makeEmailSpy();
  let touched = false;
  const trackedClient = new Proxy(client as object, {
    get(target, prop, receiver) {
      if (prop === "from") touched = true;
      return Reflect.get(target, prop, receiver);
    },
  });

  const result = await resumeLegacyClaimActivationImpl("claim-1", {
    ...authDeps(NON_FOUNDER, false),
    adminClient: trackedClient as ReturnType<typeof cleanClaimWorld>["client"],
    sendSetupEmail: email.fn,
  });

  assert.equal(result.error, "Unauthorized.");
  assert.equal(touched, false, "no table should ever be touched for a denied caller");
  assert.equal(email.calls.length, 0);
  assert.equal(world.lifecycles.rows.length, 0);
});

test("resumeLegacyClaimActivationImpl: no signed-in user is denied the same way", async () => {
  const { client } = cleanClaimWorld();
  const result = await resumeLegacyClaimActivationImpl("claim-1", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authClient: { auth: { getUser: async () => ({ data: { user: null } }) } } as any,
    checkAdmin: async () => true,
    adminClient: client,
  });
  assert.equal(result.error, "Unauthorized.");
});

// ── Eligibility failures ─────────────────────────────────────────────────────

test("resumeLegacyClaimActivationImpl: already-activated operator is ineligible — no lifecycle, no email, no note", async () => {
  const { client, world } = cleanClaimWorld({
    operators: [{ id: "op-1", account_activated_at: "2026-09-18T01:07:29.000Z", first_name: "Marnie", last_name: null, email: "marnie@el-taquero.com" }],
  });
  const email = makeEmailSpy();

  const result = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.equal(result.success, undefined);
  assert.match(result.error ?? "", /already activated/);
  assert.equal(world.lifecycles.rows.length, 0);
  assert.equal(email.calls.length, 0);
  assert.equal(world.notes.length, 0);
});

test("resumeLegacyClaimActivationImpl: wrong origin status (not approved) is ineligible", async () => {
  const { client, world } = cleanClaimWorld({ claims: [{ id: "claim-1", status: "pending", venue_id: "venue-1" }] });
  const email = makeEmailSpy();

  const result = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.match(result.error ?? "", /Only approved claims/);
  assert.equal(world.lifecycles.rows.length, 0);
  assert.equal(email.calls.length, 0);
});

test("resumeLegacySubmissionActivationImpl: wrong origin status (rejected) is ineligible", async () => {
  const { client, world } = cleanSubmissionWorld("approved", {
    submissions: [{ id: "sub-1", status: "rejected", operator_id: "op-2", venue_id: "venue-2" }],
  });
  const email = makeEmailSpy();

  const result = await resumeLegacySubmissionActivationImpl("sub-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.match(result.error ?? "", /Only confirmed_auto or founder-approved/);
  assert.equal(world.lifecycles.rows.length, 0);
  assert.equal(email.calls.length, 0);
});

test("resumeLegacyClaimActivationImpl: invalid venue/operator linkage (claimed_by !== created_by_operator_id) is ineligible", async () => {
  const { client, world } = cleanClaimWorld({ venues: [{ id: "venue-1", claimed_by: "op-1", created_by_operator_id: "op-9" }] });
  const email = makeEmailSpy();

  const result = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.match(result.error ?? "", /unambiguous operator/);
  assert.equal(world.lifecycles.rows.length, 0);
  assert.equal(email.calls.length, 0);
});

test("resumeLegacyClaimActivationImpl: live lifecycle elsewhere for the same operator is ineligible — no email, no note", async () => {
  const { client, world } = cleanClaimWorld({
    lifecycles: [
      {
        id: "lc-existing", operator_id: "op-1", origin_type: "submission", origin_claim_id: null, origin_submission_id: "sub-other",
        started_at: "2026-06-01T00:00:00.000Z", deadline_at: "2026-06-20T00:00:00.000Z", reminder_stage: 0, expired_at: null, released_at: null,
      },
    ],
  });
  const email = makeEmailSpy();

  const result = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.match(result.error ?? "", /active tracking window under a different/);
  assert.equal(world.lifecycles.rows.length, 1, "no new row must be created");
  assert.equal(email.calls.length, 0);
  assert.equal(world.notes.length, 0);
});

test("resumeLegacyClaimActivationImpl: any historical lifecycle (even released) on the exact selected origin is ineligible — no email, no note, no INSERT attempted", async () => {
  const { client, world } = cleanClaimWorld({
    lifecycles: [
      {
        id: "lc-old", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
        started_at: "2026-01-01T00:00:00.000Z", deadline_at: "2026-01-15T00:00:00.000Z", reminder_stage: 0,
        expired_at: "2026-01-16T00:00:00.000Z", released_at: "2026-01-17T00:00:00.000Z",
      },
    ],
  });
  const email = makeEmailSpy();

  const result = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.match(result.error ?? "", /already had activation tracking started/);
  assert.equal(world.lifecycles.rows.length, 1, "the pre-existing row must be untouched, no new row added");
  assert.equal(email.calls.length, 0);
  assert.equal(world.notes.length, 0);
});

// ── Operator activates during the operation (narrow race) ───────────────────

test("resumeLegacyClaimActivationImpl: operator activates in the narrow window between eligibility read and the atomic INSERT — claimOrReuseActivationLifecycle's own check blocks it, no email, no note", async () => {
  const { client, world } = cleanClaimWorld();
  // Simulate the race: by the time the atomic claim's OWN internal
  // "already activated" check runs, the operator has been activated by a
  // completely separate process (e.g. the operator completed setup via a
  // link sent through a different flow entirely, in the split second after
  // this action's own eligibility check read account_activated_at as null).
  const originalFrom = (client as { from: (t: string) => unknown }).from;
  let operatorReads = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).from = (table: string) => {
    if (table === "operators") {
      operatorReads++;
      if (operatorReads > 1) {
        world.operators[0].account_activated_at = "2026-09-18T12:00:00.000Z";
      }
    }
    return originalFrom(table);
  };
  const email = makeEmailSpy();

  const result = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.match(result.error ?? "", /already activated/);
  assert.equal(world.lifecycles.rows.length, 0);
  assert.equal(email.calls.length, 0);
  assert.equal(world.notes.length, 0);
});

// ── reused: same origin vs different origin ─────────────────────────────────

test("resumeLegacyClaimActivationImpl: two concurrent requests for the SAME origin — exactly one succeeds (started), the other gets reused-same-origin with no email and no note", async () => {
  const { client: clientA, world } = cleanClaimWorld();
  // Both "racers" read the same pre-race snapshot for the origin/live-
  // elsewhere pre-checks (both see nothing yet); their INSERT attempts
  // still race against the SAME shared lifecycle store, so the real
  // uniqueness conflict is genuinely exercised — the second caller's
  // `resolveLegacyClaimActivationOrigin` read is what's frozen, not
  // claimOrReuseActivationLifecycle's own re-read (which must see live data
  // to correctly resolve to "reused").
  const frozenLifecycleSnapshot: Row[] = [];
  const originalFromA = (clientA as { from: (t: string) => unknown }).from;
  let lifecycleReadCount = 0;
  function makeRacerClient() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const racer: any = { ...clientA };
    racer.from = (table: string) => {
      if (table === "operator_activation_lifecycles") {
        lifecycleReadCount++;
        const useFrozen = lifecycleReadCount <= 2; // this racer's own 2 pre-checks
        if (useFrozen) {
          return {
            select() {
              const filters: { col: string; val: unknown }[] = [];
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const builder: any = {
                eq(col: string, val: unknown) { filters.push({ col, val }); return builder; },
                is(col: string, val: unknown) { filters.push({ col, val }); return builder; },
                maybeSingle: async () => {
                  const match = frozenLifecycleSnapshot.find((r) => filters.every((f) => r[f.col] === f.val));
                  return { data: match ?? null, error: null };
                },
              };
              return builder;
            },
          };
        }
      }
      return originalFromA(table);
    };
    return racer;
  }

  const racerA = makeRacerClient();
  const racerB = makeRacerClient();
  const emailA = makeEmailSpy();
  const emailB = makeEmailSpy();

  const resultA = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: racerA, sendSetupEmail: emailA.fn });
  lifecycleReadCount = 0; // reset for the second racer's own pre-check count
  const resultB = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: racerB, sendSetupEmail: emailB.fn });

  assert.equal(resultA.success, true, "the first request to land wins");
  assert.equal(resultB.success, undefined);
  assert.match(resultB.error ?? "", /already started for this record/);

  assert.equal(world.lifecycles.rows.length, 1, "exactly one lifecycle exists");
  assert.equal(emailA.calls.length + emailB.calls.length, 1, "exactly one email attempt across both requests");
  assert.equal(world.notes.length, 1, "exactly one note across both requests");
});

test("resumeLegacyClaimActivationImpl: two concurrent requests for DIFFERENT origins, same operator — the loser gets reused-different-origin with no email and no note", async () => {
  const { client, world } = makeWorld({
    operators: [{ id: "op-shared", account_activated_at: null, first_name: "Shared", last_name: null, email: "shared@example.com" }],
    claims: [{ id: "claim-A", status: "approved", venue_id: "venue-A" }],
    submissions: [{ id: "sub-B", status: "approved", operator_id: "op-shared", venue_id: "venue-B" }],
    venues: [
      { id: "venue-A", claimed_by: "op-shared", created_by_operator_id: "op-shared" },
      { id: "venue-B", claimed_by: "op-shared", created_by_operator_id: "op-shared" },
    ],
  });

  const frozenLifecycleSnapshot: Row[] = [];
  const originalFrom = (client as { from: (t: string) => unknown }).from;
  let lifecycleReadCount = 0;
  function makeRacerClient() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const racer: any = { ...client };
    racer.from = (table: string) => {
      if (table === "operator_activation_lifecycles") {
        lifecycleReadCount++;
        if (lifecycleReadCount <= 2) {
          return {
            select() {
              const filters: { col: string; val: unknown }[] = [];
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const builder: any = {
                eq(col: string, val: unknown) { filters.push({ col, val }); return builder; },
                is(col: string, val: unknown) { filters.push({ col, val }); return builder; },
                maybeSingle: async () => {
                  const match = frozenLifecycleSnapshot.find((r) => filters.every((f) => r[f.col] === f.val));
                  return { data: match ?? null, error: null };
                },
              };
              return builder;
            },
          };
        }
      }
      return originalFrom(table);
    };
    return racer;
  }

  const racerClaim = makeRacerClient();
  const racerSub = makeRacerClient();
  const emailA = makeEmailSpy();
  const emailB = makeEmailSpy();

  const resultClaim = await resumeLegacyClaimActivationImpl("claim-A", { ...authDeps(FOUNDER, true), adminClient: racerClaim, sendSetupEmail: emailA.fn });
  lifecycleReadCount = 0;
  const resultSub = await resumeLegacySubmissionActivationImpl("sub-B", { ...authDeps(FOUNDER, true), adminClient: racerSub, sendSetupEmail: emailB.fn });

  assert.equal(resultClaim.success, true, "the first request to land wins");
  assert.equal(resultSub.success, undefined);
  assert.match(resultSub.error ?? "", /active tracking window under a different Claim or Submission/);

  assert.equal(world.lifecycles.rows.length, 1);
  assert.equal(emailA.calls.length + emailB.calls.length, 1);
  assert.equal(world.notes.length, 1);
});

// ── Partial failure: lifecycle created, email fails ─────────────────────────

test("resumeLegacyClaimActivationImpl: email send fails after lifecycle starts — lifecycle is kept (never deleted/expired/released), no success note, clear founder-facing failure", async () => {
  const { client, world } = cleanClaimWorld();
  const email = makeEmailSpy({ ok: false, error: "simulated provider failure" });

  const result = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.equal(result.success, undefined);
  assert.match(result.error ?? "", /Resend action/);
  assert.equal(world.lifecycles.rows.length, 1, "the lifecycle must be kept");
  assert.equal(world.lifecycles.rows[0].expired_at, null);
  assert.equal(world.lifecycles.rows[0].released_at, null);
  assert.equal(world.notes.length, 0, "no success note when email failed");
});

test("resumeLegacyClaimActivationImpl: generateLink fails after lifecycle starts — lifecycle is kept, no note, clear failure", async () => {
  const { client, world } = cleanClaimWorld({ generateLinkOk: false });
  const email = makeEmailSpy();

  const result = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.equal(result.success, undefined);
  assert.equal(world.lifecycles.rows.length, 1);
  assert.equal(email.calls.length, 0, "email must never be attempted without a real setup link");
  assert.equal(world.notes.length, 0);
});

// ── Partial failure: email succeeds, note insert fails ───────────────────────

test("resumeLegacyClaimActivationImpl: note insert fails after successful email — success is still reported, email is never resent, lifecycle is never rolled back", async () => {
  const { client, world } = cleanClaimWorld();
  const email = makeEmailSpy();
  const originalFrom = (client as { from: (t: string) => unknown }).from;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).from = (table: string) => {
    if (table === "venue_claim_notes") {
      return { insert: async () => ({ error: { message: "simulated note insert failure" } }) };
    }
    return originalFrom(table);
  };

  const result = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.equal(result.success, true, "email + lifecycle both genuinely succeeded — this is still operational success");
  assert.match(result.successAction ?? "", /could not be recorded/);
  assert.equal(email.calls.length, 1, "must never resend after a note failure");
  assert.equal(world.lifecycles.rows.length, 1);
  assert.equal(world.lifecycles.rows[0].released_at, null, "lifecycle must never be rolled back");
});

// ── Retry of this action after an ambiguous timeout ─────────────────────────
//
// SCOPE: this proves a retried call to resumeLegacyClaimActivationImpl()
// itself never sends a second email — e.g. the founder's browser timed out
// waiting for a response, but the action had already completed server-side.
// It does NOT (and cannot, at this layer) prove anything about a genuinely
// ambiguous Resend provider response to the ONE email this action attempts
// during its single successful "started" call — see the module header's
// "WHAT THIS RULE DOES AND DOES NOT COVER" note for that narrower, external
// gap, which a later manual Resend could still duplicate into.

test("resumeLegacyClaimActivationImpl: a genuine retry after the first call already succeeded never sends a second email", async () => {
  const { client, world } = cleanClaimWorld();
  const email = makeEmailSpy();

  const first = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });
  assert.equal(first.success, true);

  const retry = await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.equal(retry.success, undefined);
  assert.match(retry.error ?? "", /already had activation tracking started|already started for this record/);
  assert.equal(email.calls.length, 1, "the retry must never send a second email");
  assert.equal(world.lifecycles.rows.length, 1);
  assert.equal(world.notes.length, 1);
});

// ── Not found ────────────────────────────────────────────────────────────────

test("resumeLegacyClaimActivationImpl: claim not found returns a clear error with no side effects", async () => {
  const { client, world } = makeWorld();
  const email = makeEmailSpy();
  const result = await resumeLegacyClaimActivationImpl("missing-claim", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });
  assert.match(result.error ?? "", /not found/);
  assert.equal(world.lifecycles.rows.length, 0);
  assert.equal(email.calls.length, 0);
});

// ── Secret hygiene ───────────────────────────────────────────────────────────

test("resumeLegacyClaimActivationImpl: the structured note never contains the setup link/token", async () => {
  const { client, world } = cleanClaimWorld();
  const email = makeEmailSpy();
  await resumeLegacyClaimActivationImpl("claim-1", { ...authDeps(FOUNDER, true), adminClient: client, sendSetupEmail: email.fn });

  assert.equal(world.notes.length, 1);
  const noteStr = JSON.stringify(world.notes[0]);
  assert.doesNotMatch(noteStr, /fake-setup-link/);
  assert.doesNotMatch(noteStr, /token|password|secret/i);
});
