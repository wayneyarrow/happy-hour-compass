import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getActivationPresentationsForClaims,
  getActivationPresentationsForSubmissions,
  getActivationPresentationForClaim,
  shouldShowSubmissionActivationCard,
  evaluateSubmissionResendEligibility,
  type ActivationPresentation,
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

function makeFakeClient(lifecycleRows: FakeLifecycleRow[], operatorRows: FakeOperatorRow[]) {
  let lifecycleQueryCount = 0;
  let operatorQueryCount = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      if (table === "operator_activation_lifecycles") {
        return {
          select() {
            return {
              in(col: string, ids: string[]) {
                lifecycleQueryCount++;
                const data = lifecycleRows.filter((r) =>
                  ids.includes((r as unknown as Record<string, string | null>)[col] as string)
                );
                return Promise.resolve({ data, error: null });
              },
            };
          },
        };
      }
      if (table === "operators") {
        return {
          select() {
            return {
              in(_col: string, ids: string[]) {
                operatorQueryCount++;
                const data = operatorRows.filter((r) => ids.includes(r.id));
                return Promise.resolve({ data, error: null });
              },
            };
          },
        };
      }
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
