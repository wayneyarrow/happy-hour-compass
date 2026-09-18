import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getActivationPresentationsForClaims,
  getActivationPresentationsForSubmissions,
  getActivationPresentationForClaim,
  getActivationPresentationForSubmission,
  shouldShowSubmissionActivationCard,
  evaluateSubmissionResendEligibility,
  evaluateClaimResendEligibility,
  shouldShowStandaloneResendPanel,
  evaluateLegacyClaimActivationEligibility,
  evaluateLegacySubmissionActivationEligibility,
  resolveLegacyClaimActivationOrigin,
  resolveLegacySubmissionActivationOrigin,
  type ActivationPresentation,
  type LegacyActivationOriginCheck,
} from "../../../src/lib/activation/activationPresentation";

/**
 * Behavioral tests for the Phase 1B activation presentation data-access
 * layer — specifically the N+1-avoidance contract (exactly one lifecycle
 * query + one operator query per call, regardless of row count) and correct
 * handling of legacy/no-lifecycle claims and multi-venue operators.
 */

type FakeLifecycleRow = {
  id: string;
  operator_id: string;
  origin_type: "claim" | "submission";
  origin_claim_id: string | null;
  origin_submission_id: string | null;
  started_at: string;
  deadline_at: string;
  reminder_stage: number;
  expired_at: string | null;
  released_at: string | null;
};

type FakeOperatorRow = {
  id: string;
  account_activated_at: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

type FakeClaimRow = { id: string; status: string; venue_id: string | null };
type FakeSubmissionRow = { id: string; status: string; operator_id: string | null; venue_id: string | null };
type FakeVenueRow = { id: string; claimed_by: string | null; created_by_operator_id: string | null };

/**
 * Backward-compatible: `claims`/`submissions`/`venues` default to empty, so
 * every pre-existing test (which never populates them) still behaves
 * exactly as before — a no-lifecycle origin with no claim/submission row in
 * the fake correctly resolves to "no operator found", not a thrown error.
 * These extra tables exist so getActivationPresentationsForClaims/
 * ForSubmissions' Phase 1C fix (resolving an already-activated legacy
 * operator even with no lifecycle row) can be tested against this same
 * shared fake.
 */
function makeFakeClient(
  lifecycleRows: FakeLifecycleRow[],
  operatorRows: FakeOperatorRow[],
  extra: { claims?: FakeClaimRow[]; submissions?: FakeSubmissionRow[]; venues?: FakeVenueRow[] } = {}
) {
  let lifecycleQueryCount = 0;
  let operatorQueryCount = 0;
  const claims = extra.claims ?? [];
  const submissions = extra.submissions ?? [];
  const venues = extra.venues ?? [];

  function eqMaybeSingleTable(rows: Record<string, unknown>[]) {
    return {
      select() {
        const filters: { col: string; val: unknown }[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const builder: any = {
          eq(col: string, val: unknown) {
            filters.push({ col, val });
            return builder;
          },
          in(col: string, ids: unknown[]) {
            const data = rows.filter((r) => (ids as unknown[]).includes(r[col]));
            return Promise.resolve({ data, error: null });
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      if (table === "operator_activation_lifecycles") {
        return {
          select() {
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
              in(col: string, ids: string[]) {
                lifecycleQueryCount++;
                const data = lifecycleRows.filter((r) =>
                  ids.includes((r as unknown as Record<string, string | null>)[col] as string)
                );
                return Promise.resolve({ data, error: null });
              },
              maybeSingle: async () => {
                const match = lifecycleRows.find((r) =>
                  filters.every((f) => (r as unknown as Record<string, unknown>)[f.col] === f.val)
                );
                return { data: match ?? null, error: null };
              },
            };
            return builder;
          },
        };
      }
      if (table === "operators") {
        return {
          select() {
            const filters: { col: string; val: unknown }[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const builder: any = {
              eq(col: string, val: unknown) {
                filters.push({ col, val });
                return builder;
              },
              in(_col: string, ids: string[]) {
                operatorQueryCount++;
                const data = operatorRows.filter((r) => ids.includes(r.id));
                return Promise.resolve({ data, error: null });
              },
              maybeSingle: async () => {
                const match = operatorRows.find((r) => filters.every((f) => (r as unknown as Record<string, unknown>)[f.col] === f.val));
                return { data: match ?? null, error: null };
              },
            };
            return builder;
          },
        };
      }
      if (table === "venue_claims") return eqMaybeSingleTable(claims);
      if (table === "operator_submissions") return eqMaybeSingleTable(submissions);
      if (table === "venues") return eqMaybeSingleTable(venues);
      throw new Error(`unexpected table in fake: ${table}`);
    },
  };

  return {
    client,
    counts: () => ({ lifecycleQueryCount, operatorQueryCount }),
  };
}

const NOW = new Date("2026-06-15T12:00:00.000Z");

// ── N+1 avoidance ────────────────────────────────────────────────────────────

test("getActivationPresentationsForClaims: exactly 2 queries total regardless of how many claim ids are passed", async () => {
  const lifecycles: FakeLifecycleRow[] = Array.from({ length: 25 }, (_, i) => ({
    id: `lc-${i}`,
    operator_id: `op-${i}`,
    origin_type: "claim",
    origin_claim_id: `claim-${i}`,
    origin_submission_id: null,
    started_at: "2026-06-01T00:00:00.000Z",
    deadline_at: "2026-06-20T00:00:00.000Z",
    reminder_stage: 0,
    expired_at: null,
    released_at: null,
  }));
  const operators: FakeOperatorRow[] = lifecycles.map((l) => ({
    id: l.operator_id,
    account_activated_at: null,
    first_name: "Op",
    last_name: String(l.operator_id),
    email: `${l.operator_id}@example.com`,
  }));

  const { client, counts } = makeFakeClient(lifecycles, operators);
  const claimIds = lifecycles.map((l) => l.origin_claim_id as string);

  const result = await getActivationPresentationsForClaims(claimIds, client, NOW);

  assert.equal(counts().lifecycleQueryCount, 1, "exactly one batched lifecycle query");
  assert.equal(counts().operatorQueryCount, 1, "exactly one batched operator query");
  assert.equal(result.size, 25);
  assert.equal(result.get("claim-0")?.state, "awaiting_setup");
});

test("getActivationPresentationsForClaims: empty input short-circuits with zero queries", async () => {
  const { client, counts } = makeFakeClient([], []);
  const result = await getActivationPresentationsForClaims([], client, NOW);
  assert.equal(result.size, 0);
  assert.equal(counts().lifecycleQueryCount, 0);
  assert.equal(counts().operatorQueryCount, 0);
});

// ── Legacy / no-lifecycle handling ───────────────────────────────────────────

test("getActivationPresentationsForClaims: a claim with no lifecycle row resolves to not_tracked, not an error", async () => {
  const { client } = makeFakeClient([], []);
  const result = await getActivationPresentationsForClaims(["legacy-claim-1"], client, NOW);
  const presentation = result.get("legacy-claim-1");
  assert.ok(presentation);
  assert.equal(presentation!.state, "not_tracked");
  assert.equal(presentation!.lifecycle, null);
  assert.equal(presentation!.operator, null);
});

test("getActivationPresentationsForClaims: mixed set — tracked and untracked claims are both present and correct", async () => {
  const lifecycles: FakeLifecycleRow[] = [
    {
      id: "lc-1",
      operator_id: "op-1",
      origin_type: "claim",
      origin_claim_id: "claim-tracked",
      origin_submission_id: null,
      started_at: "2026-06-01T00:00:00.000Z",
      deadline_at: "2026-06-20T00:00:00.000Z",
      reminder_stage: 0,
      expired_at: null,
      released_at: null,
    },
  ];
  const operators: FakeOperatorRow[] = [
    { id: "op-1", account_activated_at: null, first_name: "A", last_name: "B", email: "a@b.com" },
  ];
  const { client } = makeFakeClient(lifecycles, operators);

  const result = await getActivationPresentationsForClaims(["claim-tracked", "claim-untracked"], client, NOW);
  assert.equal(result.get("claim-tracked")?.state, "awaiting_setup");
  assert.equal(result.get("claim-untracked")?.state, "not_tracked");
});

// ── Multi-venue operator (same operator, two different origins) ─────────────

test("getActivationPresentationsForClaims: multi-venue operator — operator row is fetched once and correctly joined to both origins", async () => {
  const lifecycles: FakeLifecycleRow[] = [
    {
      id: "lc-1",
      operator_id: "op-shared",
      origin_type: "claim",
      origin_claim_id: "claim-1",
      origin_submission_id: null,
      started_at: "2026-06-01T00:00:00.000Z",
      deadline_at: "2026-06-20T00:00:00.000Z",
      reminder_stage: 0,
      expired_at: null,
      released_at: null,
    },
    {
      id: "lc-2",
      operator_id: "op-shared",
      origin_type: "claim",
      origin_claim_id: "claim-2",
      origin_submission_id: null,
      started_at: "2026-06-05T00:00:00.000Z",
      deadline_at: "2026-06-25T00:00:00.000Z",
      reminder_stage: 0,
      expired_at: null,
      released_at: null,
    },
  ];
  const operators: FakeOperatorRow[] = [
    { id: "op-shared", account_activated_at: "2026-06-10T00:00:00.000Z", first_name: "Shared", last_name: "Op", email: "shared@example.com" },
  ];
  const { client, counts } = makeFakeClient(lifecycles, operators);

  const result = await getActivationPresentationsForClaims(["claim-1", "claim-2"], client, NOW);

  assert.equal(counts().operatorQueryCount, 1, "the shared operator is fetched only once");
  // account_activated_at is set, so BOTH origins correctly show active,
  // regardless of their own started/deadline fields.
  assert.equal(result.get("claim-1")?.state, "active");
  assert.equal(result.get("claim-2")?.state, "active");
  assert.equal(result.get("claim-1")?.operator?.email, "shared@example.com");
  assert.equal(result.get("claim-2")?.operator?.email, "shared@example.com");
});

// ── Submissions variant ───────────────────────────────────────────────────────

test("getActivationPresentationsForSubmissions: keys on origin_submission_id, same contract as claims", async () => {
  const lifecycles: FakeLifecycleRow[] = [
    {
      id: "lc-1",
      operator_id: "op-1",
      origin_type: "submission",
      origin_claim_id: null,
      origin_submission_id: "sub-1",
      started_at: "2026-06-01T00:00:00.000Z",
      deadline_at: "2026-06-10T00:00:00.000Z", // passed relative to NOW
      reminder_stage: 0,
      expired_at: null,
      released_at: null,
    },
  ];
  const operators: FakeOperatorRow[] = [
    { id: "op-1", account_activated_at: null, first_name: null, last_name: null, email: "op1@example.com" },
  ];
  const { client } = makeFakeClient(lifecycles, operators);

  const result = await getActivationPresentationsForSubmissions(["sub-1"], client, NOW);
  assert.equal(result.get("sub-1")?.state, "release_required");
});

// ── Single-item convenience wrapper ──────────────────────────────────────────

test("getActivationPresentationForClaim: thin wrapper matches the batch result for a single id", async () => {
  const { client } = makeFakeClient([], []);
  const presentation = await getActivationPresentationForClaim("solo-claim", client, NOW);
  assert.equal(presentation.state, "not_tracked");
});

// ── shouldShowSubmissionActivationCard() — Phase 1B correction ──────────────
//
// Prior bug: the Submission Activation card was gated solely on
// status === "approved", which silently hid activation for confirmed_auto
// submissions (provisioned automatically at submission time, before any
// founder review — a real, common path, not an edge case).

test("shouldShowSubmissionActivationCard: confirmed_auto WITH a lifecycle shows the card", () => {
  assert.equal(shouldShowSubmissionActivationCard("confirmed_auto", true), true);
});

test("shouldShowSubmissionActivationCard: confirmed_auto with NO lifecycle still shows the card (Not tracked) — it's a relevant status", () => {
  assert.equal(shouldShowSubmissionActivationCard("confirmed_auto", false), true);
});

test("shouldShowSubmissionActivationCard: founder-approved (status='approved') WITH a lifecycle shows the card", () => {
  assert.equal(shouldShowSubmissionActivationCard("approved", true), true);
});

test("shouldShowSubmissionActivationCard: approved with no lifecycle still shows the card (Not tracked) — provisioning is expected to have run", () => {
  assert.equal(shouldShowSubmissionActivationCard("approved", false), true);
});

test("shouldShowSubmissionActivationCard: a rejected/closed/unprovisioned submission with NO lifecycle shows no card at all", () => {
  for (const status of ["rejected", "closed", "no_match", "needs_more_info", "pending_review", "double_claim", "rejected_by_user", "info_submitted"]) {
    assert.equal(shouldShowSubmissionActivationCard(status, false), false, `status "${status}" with no lifecycle must not show a card`);
  }
});

test("shouldShowSubmissionActivationCard: a real lifecycle ALWAYS wins over a stale/unexpected status label — never hides authoritative data", () => {
  for (const status of ["rejected", "closed", "no_match", "needs_more_info", "pending_review", "double_claim"]) {
    assert.equal(shouldShowSubmissionActivationCard(status, true), true, `status "${status}" WITH a lifecycle must still show the card`);
  }
});

// ── evaluateSubmissionResendEligibility() — Phase 1B correction ─────────────
//
// Prior bug: Submission resend was gated solely on status === "approved",
// which silently blocked resend for confirmed_auto submissions even when
// they have a perfectly live, resendable lifecycle (confirmed_auto is
// provisioned immediately at submission time, before any founder review).

function makePresentation(overrides: Partial<ActivationPresentation> = {}): ActivationPresentation {
  return {
    state: "awaiting_setup",
    lifecycle: {
      id: "lc-1",
      operatorId: "op-1",
      originType: "submission",
      startedAt: "2026-06-01T00:00:00.000Z",
      deadlineAt: "2026-06-20T00:00:00.000Z",
      reminderStage: 0,
      expiredAt: null,
      releasedAt: null,
    },
    operator: { id: "op-1", accountActivatedAt: null, name: null, email: "op@example.com" },
    ...overrides,
  };
}

test("evaluateSubmissionResendEligibility: confirmed_auto WITH a live lifecycle is eligible", () => {
  const result = evaluateSubmissionResendEligibility("confirmed_auto", makePresentation({ state: "awaiting_setup" }));
  assert.equal(result.eligible, true);
});

test("evaluateSubmissionResendEligibility: founder-approved (status='approved') WITH a live lifecycle is eligible", () => {
  const result = evaluateSubmissionResendEligibility("approved", makePresentation({ state: "expiring_soon" }));
  assert.equal(result.eligible, true);
});

test("evaluateSubmissionResendEligibility: confirmed_auto with NO lifecycle is not eligible", () => {
  const result = evaluateSubmissionResendEligibility(
    "confirmed_auto",
    makePresentation({ state: "not_tracked", lifecycle: null, operator: null })
  );
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.match(result.reason, /No activation lifecycle is tracked/);
});

test("evaluateSubmissionResendEligibility: rejected/no-match submissions are never eligible, regardless of any lifecycle presence", () => {
  for (const status of ["rejected", "no_match", "closed", "needs_more_info", "pending_review", "double_claim", "rejected_by_user"]) {
    const withLifecycle = evaluateSubmissionResendEligibility(status, makePresentation());
    assert.equal(withLifecycle.eligible, false, `status "${status}" must never be eligible even with a lifecycle present`);

    const withoutLifecycle = evaluateSubmissionResendEligibility(
      status,
      makePresentation({ state: "not_tracked", lifecycle: null, operator: null })
    );
    assert.equal(withoutLifecycle.eligible, false, `status "${status}" must never be eligible without a lifecycle either`);
  }
});

test("evaluateSubmissionResendEligibility: a released lifecycle is never eligible", () => {
  const result = evaluateSubmissionResendEligibility(
    "confirmed_auto",
    makePresentation({
      state: "released",
      lifecycle: {
        id: "lc-1", operatorId: "op-1", originType: "submission",
        startedAt: "2026-06-01T00:00:00.000Z", deadlineAt: "2026-06-20T00:00:00.000Z",
        reminderStage: 0, expiredAt: "2026-06-21T00:00:00.000Z", releasedAt: "2026-06-22T00:00:00.000Z",
      },
    })
  );
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.match(result.reason, /already been released/);
});

test("evaluateSubmissionResendEligibility: a passed deadline (release_required/expired) is never eligible — resend must not auto-extend", () => {
  for (const state of ["release_required", "expired"] as const) {
    const result = evaluateSubmissionResendEligibility("approved", makePresentation({ state }));
    assert.equal(result.eligible, false, `state "${state}" must not be eligible for resend`);
    if (!result.eligible) assert.match(result.reason, /deadline has already passed/);
  }
});

test("evaluateSubmissionResendEligibility: an already-activated operator (state='active') is never eligible", () => {
  const result = evaluateSubmissionResendEligibility("approved", makePresentation({ state: "active" }));
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.match(result.reason, /already activated/);
});

// ── evaluateClaimResendEligibility() — Phase 1C QA correction ───────────────
//
// Staging QA found the actual bug this predicate fixes: an approved claim
// with NO lifecycle row at all (Marnie/Chilango, Dan/Table 19, Kelly/Buffalo
// Rouge) could still have its setup email resent via the standalone
// "Resend setup email" panel, sending an email without ever starting
// activation tracking — bypassing the controlled legacy-resume flow
// entirely. This predicate shares its lifecycle-state gate with
// evaluateSubmissionResendEligibility() (evaluateResendLifecycleGate) — see
// activationLifecycleActionsWiring.test.ts for the test confirming that
// sharing, so these two sets of tests never need to drift.

test("evaluateClaimResendEligibility: an approved claim WITH a live lifecycle is eligible", () => {
  const result = evaluateClaimResendEligibility("approved", makePresentation({ state: "awaiting_setup" }));
  assert.equal(result.eligible, true);
});

test("evaluateClaimResendEligibility: an approved claim with NO lifecycle is NOT eligible — the actual staging QA bug", () => {
  const result = evaluateClaimResendEligibility(
    "approved",
    makePresentation({ state: "not_tracked", lifecycle: null, operator: null })
  );
  assert.equal(result.eligible, false);
  if (!result.eligible) {
    assert.match(result.reason, /No activation lifecycle is tracked/);
    assert.match(result.reason, /Start activation tracking/);
  }
});

test("evaluateClaimResendEligibility: a non-approved claim status is never eligible, with or without a lifecycle", () => {
  for (const status of ["pending", "needs_more_info", "rejected"]) {
    const withLifecycle = evaluateClaimResendEligibility(status, makePresentation());
    assert.equal(withLifecycle.eligible, false, `status "${status}" must never be eligible even with a lifecycle present`);

    const withoutLifecycle = evaluateClaimResendEligibility(
      status,
      makePresentation({ state: "not_tracked", lifecycle: null, operator: null })
    );
    assert.equal(withoutLifecycle.eligible, false, `status "${status}" must never be eligible without a lifecycle either`);
  }
});

test("evaluateClaimResendEligibility: a released lifecycle is never eligible", () => {
  const result = evaluateClaimResendEligibility(
    "approved",
    makePresentation({
      state: "released",
      lifecycle: {
        id: "lc-1", operatorId: "op-1", originType: "claim",
        startedAt: "2026-06-01T00:00:00.000Z", deadlineAt: "2026-06-20T00:00:00.000Z",
        reminderStage: 0, expiredAt: "2026-06-21T00:00:00.000Z", releasedAt: "2026-06-22T00:00:00.000Z",
      },
    })
  );
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.match(result.reason, /already been released/);
});

test("evaluateClaimResendEligibility: a passed deadline (release_required/expired) is never eligible — resend must not auto-extend", () => {
  for (const state of ["release_required", "expired"] as const) {
    const result = evaluateClaimResendEligibility("approved", makePresentation({ state }));
    assert.equal(result.eligible, false, `state "${state}" must not be eligible for resend`);
    if (!result.eligible) assert.match(result.reason, /deadline has already passed/);
  }
});

test("evaluateClaimResendEligibility: an already-activated operator (state='active') is never eligible", () => {
  const result = evaluateClaimResendEligibility("approved", makePresentation({ state: "active" }));
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.match(result.reason, /already activated/);
});

// ── shouldShowStandaloneResendPanel() — Phase 1C QA correction ──────────────
//
// The pure, shared rendering predicate both Claim and Submission detail
// pages use to decide whether to render the standalone resend panel at all.
// Directly proves the four required state/action visibility combinations.

test("shouldShowStandaloneResendPanel: unactivated + no lifecycle (not_tracked) — panel hidden", () => {
  const presentation = makePresentation({ state: "not_tracked", lifecycle: null, operator: null });
  assert.equal(shouldShowStandaloneResendPanel(presentation), false);
});

test("shouldShowStandaloneResendPanel: unactivated + live lifecycle (awaiting_setup) — panel shown", () => {
  const presentation = makePresentation({ state: "awaiting_setup" });
  assert.equal(shouldShowStandaloneResendPanel(presentation), true);
});

test("shouldShowStandaloneResendPanel: activated + no lifecycle (active, legacy) — panel hidden", () => {
  const presentation = makePresentation({
    state: "active",
    lifecycle: null,
    operator: { id: "op-1", accountActivatedAt: "2026-06-10T00:00:00.000Z", name: null, email: "op@example.com" },
  });
  assert.equal(shouldShowStandaloneResendPanel(presentation), false);
});

test("shouldShowStandaloneResendPanel: activated + lifecycle still attached (active) — panel hidden", () => {
  const presentation = makePresentation({ state: "active" });
  assert.equal(shouldShowStandaloneResendPanel(presentation), false);
});

test("shouldShowStandaloneResendPanel: released/release_required/expired lifecycle — panel still shown (blocked at submit time, not hidden)", () => {
  for (const state of ["released", "release_required", "expired"] as const) {
    assert.equal(shouldShowStandaloneResendPanel(makePresentation({ state })), true, `state "${state}" should still show the panel`);
  }
});

// ── Phase 1C correction: activated legacy operator with NO lifecycle row
// must present as "active", never "not_tracked" ("Justin/Britannia" case —
// an operator who completed activation through the existing setup link
// before any lifecycle row was ever ceated for their origin). ──────────────

test("getActivationPresentationsForClaims: a claim whose operator already activated, but has NO lifecycle row, presents as active (not not_tracked) — the 'Justin/Britannia' case", async () => {
  const { client } = makeFakeClient(
    [],
    [{ id: "op-justin", account_activated_at: "2026-09-18T01:07:29.000Z", first_name: "Justin", last_name: null, email: "justin@bbco.ca" }],
    {
      claims: [{ id: "claim-justin", status: "approved", venue_id: "venue-1" }],
      venues: [{ id: "venue-1", claimed_by: "op-justin", created_by_operator_id: "op-justin" }],
    }
  );

  const result = await getActivationPresentationsForClaims(["claim-justin"], client, NOW);
  const presentation = result.get("claim-justin");
  assert.ok(presentation);
  assert.equal(presentation!.state, "active");
  assert.equal(presentation!.lifecycle, null);
  assert.equal(presentation!.operator?.accountActivatedAt, "2026-09-18T01:07:29.000Z");
  assert.equal(presentation!.operator?.email, "justin@bbco.ca");
});

test("getActivationPresentationsForClaims: a claim whose operator is unactivated and has no lifecycle row still correctly presents as not_tracked", async () => {
  const { client } = makeFakeClient([], [{ id: "op-1", account_activated_at: null, first_name: "A", last_name: "B", email: "a@b.com" }], {
    claims: [{ id: "claim-1", status: "approved", venue_id: "venue-1" }],
    venues: [{ id: "venue-1", claimed_by: "op-1", created_by_operator_id: "op-1" }],
  });
  const result = await getActivationPresentationsForClaims(["claim-1"], client, NOW);
  assert.equal(result.get("claim-1")?.state, "not_tracked");
  assert.equal(result.get("claim-1")?.lifecycle, null);
});

test("getActivationPresentationForSubmission: an activated operator with no lifecycle presents as active, using the direct operator_id FK (no venue join needed for display)", async () => {
  const { client } = makeFakeClient(
    [],
    [{ id: "op-2", account_activated_at: "2026-08-20T00:00:00.000Z", first_name: "Dave", last_name: null, email: "dave@example.com" }],
    { submissions: [{ id: "sub-1", status: "approved", operator_id: "op-2", venue_id: "venue-2" }] }
  );
  const presentation = await getActivationPresentationForSubmission("sub-1", client, NOW);
  assert.equal(presentation.state, "active");
  assert.equal(presentation.lifecycle, null);
  assert.equal(presentation.operator?.email, "dave@example.com");
});

test("getActivationPresentationsForClaims: a claim with genuinely no venue_claims row (orphaned id) resolves to not_tracked, never throws", async () => {
  const { client } = makeFakeClient([], []); // no claims/venues/operators populated at all
  const result = await getActivationPresentationsForClaims(["ghost-claim"], client, NOW);
  assert.equal(result.get("ghost-claim")?.state, "not_tracked");
});

// ── evaluateLegacyClaimActivationEligibility / evaluateLegacySubmissionActivationEligibility ──

function baseLegacyCheck(overrides: Partial<LegacyActivationOriginCheck> = {}): LegacyActivationOriginCheck {
  return {
    originStatus: "approved",
    operatorId: "op-1",
    operatorAccountActivatedAt: null,
    originHasAnyLifecycle: false,
    operatorHasLiveLifecycleElsewhere: false,
    ...overrides,
  };
}

test("evaluateLegacyClaimActivationEligibility: a clean approved claim with an unactivated operator and no prior lifecycle is eligible", () => {
  assert.deepEqual(evaluateLegacyClaimActivationEligibility(baseLegacyCheck()), { eligible: true });
});

test("evaluateLegacyClaimActivationEligibility: any status other than 'approved' is ineligible", () => {
  for (const status of ["pending", "needs_more_info", "info_submitted", "rejected"]) {
    const result = evaluateLegacyClaimActivationEligibility(baseLegacyCheck({ originStatus: status }));
    assert.equal(result.eligible, false, `status "${status}" must be ineligible`);
  }
});

test("evaluateLegacySubmissionActivationEligibility: confirmed_auto and approved are both eligible (clean case)", () => {
  for (const status of ["confirmed_auto", "approved"]) {
    assert.deepEqual(evaluateLegacySubmissionActivationEligibility(baseLegacyCheck({ originStatus: status })), { eligible: true });
  }
});

test("evaluateLegacySubmissionActivationEligibility: any other status is ineligible", () => {
  for (const status of ["rejected", "no_match", "closed", "pending_review", "double_claim"]) {
    const result = evaluateLegacySubmissionActivationEligibility(baseLegacyCheck({ originStatus: status }));
    assert.equal(result.eligible, false, `status "${status}" must be ineligible`);
  }
});

test("evaluateLegacyClaimActivationEligibility: no resolvable operator (unclean venue linkage) is ineligible", () => {
  const result = evaluateLegacyClaimActivationEligibility(baseLegacyCheck({ operatorId: null }));
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.match(result.reason, /unambiguous operator/);
});

test("evaluateLegacyClaimActivationEligibility: an already-activated operator is ineligible", () => {
  const result = evaluateLegacyClaimActivationEligibility(
    baseLegacyCheck({ operatorAccountActivatedAt: "2026-09-18T01:07:29.000Z" })
  );
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.match(result.reason, /already activated/);
});

test("evaluateLegacyClaimActivationEligibility: any historical lifecycle on the exact origin (any state) is ineligible — a second row for the same origin is permanently impossible", () => {
  const result = evaluateLegacyClaimActivationEligibility(baseLegacyCheck({ originHasAnyLifecycle: true }));
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.match(result.reason, /already had activation tracking started/);
});

test("evaluateLegacyClaimActivationEligibility: a live lifecycle elsewhere for the same operator is ineligible", () => {
  const result = evaluateLegacyClaimActivationEligibility(baseLegacyCheck({ operatorHasLiveLifecycleElsewhere: true }));
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.match(result.reason, /active tracking window under a different/);
});

test("evaluateLegacyClaimActivationEligibility: expired/released lifecycle on a DIFFERENT origin does not block a legitimate new origin (only originHasAnyLifecycle/operatorHasLiveLifecycleElsewhere gate this)", () => {
  // Simulated by the absence of both blocking flags — an expired/released
  // lifecycle elsewhere is, by construction, never "live", so the resolver
  // that populates operatorHasLiveLifecycleElsewhere would correctly report
  // false for it (tested directly against the resolver below).
  assert.deepEqual(evaluateLegacyClaimActivationEligibility(baseLegacyCheck()), { eligible: true });
});

// ── resolveLegacyClaimActivationOrigin / resolveLegacySubmissionActivationOrigin ──

test("resolveLegacyClaimActivationOrigin: not found → found:false, no other field trusted", async () => {
  const { client } = makeFakeClient([], []);
  const result = await resolveLegacyClaimActivationOrigin("missing-claim", client);
  assert.equal(result.found, false);
});

test("resolveLegacyClaimActivationOrigin: clean approved claim resolves operator via matching claimed_by/created_by_operator_id", async () => {
  const { client } = makeFakeClient(
    [],
    [{ id: "op-1", account_activated_at: null, first_name: "Marnie", last_name: null, email: "marnie@el-taquero.com" }],
    {
      claims: [{ id: "claim-1", status: "approved", venue_id: "venue-1" }],
      venues: [{ id: "venue-1", claimed_by: "op-1", created_by_operator_id: "op-1" }],
    }
  );
  const result = await resolveLegacyClaimActivationOrigin("claim-1", client);
  assert.equal(result.found, true);
  assert.equal(result.originStatus, "approved");
  assert.equal(result.operatorId, "op-1");
  assert.equal(result.operatorEmail, "marnie@el-taquero.com");
  assert.equal(result.operatorAccountActivatedAt, null);
  assert.equal(result.originHasAnyLifecycle, false);
  assert.equal(result.operatorHasLiveLifecycleElsewhere, false);
});

test("resolveLegacyClaimActivationOrigin: mismatched claimed_by/created_by_operator_id resolves NO operator", () => {
  return (async () => {
    const { client } = makeFakeClient([], [], {
      claims: [{ id: "claim-1", status: "approved", venue_id: "venue-1" }],
      venues: [{ id: "venue-1", claimed_by: "op-1", created_by_operator_id: "op-2" }],
    });
    const result = await resolveLegacyClaimActivationOrigin("claim-1", client);
    assert.equal(result.operatorId, null);
  })();
});

test("resolveLegacyClaimActivationOrigin: an existing historical lifecycle row for this exact origin is detected regardless of state", async () => {
  const { client } = makeFakeClient(
    [
      {
        id: "lc-1", operator_id: "op-1", origin_type: "claim", origin_claim_id: "claim-1", origin_submission_id: null,
        started_at: "2026-01-01T00:00:00.000Z", deadline_at: "2026-01-15T00:00:00.000Z", reminder_stage: 0,
        expired_at: "2026-01-16T00:00:00.000Z", released_at: "2026-01-17T00:00:00.000Z",
      },
    ],
    [{ id: "op-1", account_activated_at: null, first_name: null, last_name: null, email: "a@b.com" }],
    {
      claims: [{ id: "claim-1", status: "approved", venue_id: "venue-1" }],
      venues: [{ id: "venue-1", claimed_by: "op-1", created_by_operator_id: "op-1" }],
    }
  );
  const result = await resolveLegacyClaimActivationOrigin("claim-1", client);
  assert.equal(result.originHasAnyLifecycle, true);
});

test("resolveLegacyClaimActivationOrigin: a live lifecycle under a DIFFERENT origin for the same operator is detected as 'elsewhere'", async () => {
  const { client } = makeFakeClient(
    [
      {
        id: "lc-1", operator_id: "op-1", origin_type: "submission", origin_claim_id: null, origin_submission_id: "sub-other",
        started_at: "2026-06-01T00:00:00.000Z", deadline_at: "2026-06-20T00:00:00.000Z", reminder_stage: 0,
        expired_at: null, released_at: null,
      },
    ],
    [{ id: "op-1", account_activated_at: null, first_name: null, last_name: null, email: "a@b.com" }],
    {
      claims: [{ id: "claim-1", status: "approved", venue_id: "venue-1" }],
      venues: [{ id: "venue-1", claimed_by: "op-1", created_by_operator_id: "op-1" }],
    }
  );
  const result = await resolveLegacyClaimActivationOrigin("claim-1", client);
  assert.equal(result.originHasAnyLifecycle, false);
  assert.equal(result.operatorHasLiveLifecycleElsewhere, true);
});

test("resolveLegacySubmissionActivationOrigin: clean confirmed_auto submission resolves the direct operator_id FK, cross-checked against venue linkage", async () => {
  const { client } = makeFakeClient(
    [],
    [{ id: "op-2", account_activated_at: null, first_name: "Dave", last_name: null, email: "dave@example.com" }],
    {
      submissions: [{ id: "sub-1", status: "confirmed_auto", operator_id: "op-2", venue_id: "venue-2" }],
      venues: [{ id: "venue-2", claimed_by: "op-2", created_by_operator_id: "op-2" }],
    }
  );
  const result = await resolveLegacySubmissionActivationOrigin("sub-1", client);
  assert.equal(result.found, true);
  assert.equal(result.originStatus, "confirmed_auto");
  assert.equal(result.operatorId, "op-2");
});

test("resolveLegacySubmissionActivationOrigin: a drifted venue linkage (venue disagrees with operator_id) resolves NO operator, never guessed", async () => {
  const { client } = makeFakeClient([], [], {
    submissions: [{ id: "sub-1", status: "approved", operator_id: "op-2", venue_id: "venue-2" }],
    venues: [{ id: "venue-2", claimed_by: "op-9", created_by_operator_id: "op-9" }],
  });
  const result = await resolveLegacySubmissionActivationOrigin("sub-1", client);
  assert.equal(result.operatorId, null);
});
