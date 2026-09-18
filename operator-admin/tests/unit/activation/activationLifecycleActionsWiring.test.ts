import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-inspection tests for Phase 1B's founder-controls actions:
 *   - extendActivationDeadlineAction (exported wrapper) / extendActivationDeadlineImpl (real logic)
 *   - resendClaimSetupEmailAction (exported wrapper) / resendClaimSetupEmailImpl (real logic)
 *   - resendSubmissionSetupEmailAction (no wrapper/impl split — see rationale below)
 *
 * ARCHITECTURE (Phase 1B correction — "Server Action boundary"): a prior
 * version put a `deps` dependency-override parameter directly on the two
 * EXPORTED "use server" actions so tests could inject a fake Supabase
 * client / admin-check. A review flagged that as a defect: Next.js treats
 * every exported async function in a "use server" file as a real,
 * network-callable action, so a dependency-override parameter on one is an
 * authorization-bypass surface reachable from a crafted client request,
 * regardless of whether today's transport makes it hard to exploit. The fix
 * splits each into two files:
 *   - A plain module with NO "use server" directive holding the real logic
 *     and the DI seam (resendClaimSetupEmailImpl.ts,
 *     extendActivationDeadlineImpl.ts) — never network-reachable, so `deps`
 *     there is safe. Behavioral tests import these directly (see
 *     activationLifecycleActionsBehavior.test.ts,
 *     resendClaimSetupEmailAuthorization.test.ts).
 *   - The "use server" file keeps only a thin, FIXED-signature wrapper —
 *     `(id, prevState, formData)`, nothing else — that calls the impl with
 *     no `deps`. The tests below pin that this wrapper genuinely has no
 *     override surface.
 *
 * resendSubmissionSetupEmailAction was never given a `deps` parameter in
 * the first place (confirmed below) and has no behavioral tests — its
 * eligibility logic is instead exercised through the pure, exported
 * evaluateSubmissionResendEligibility() predicate (see
 * activationPresentation.test.ts), which needs no Supabase client at all.
 */

const EXTEND_IMPL_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/activation/extendActivationDeadlineImpl.ts"),
  "utf8"
);
const EXTEND_WRAPPER_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/activation/activationLifecycleActions.ts"),
  "utf8"
);
const RESEND_CLAIM_IMPL_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/claims/[id]/resendClaimSetupEmailImpl.ts"),
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
const SUBMISSIONS_LIST_PAGE_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/operator-submissions/page.tsx"),
  "utf8"
);
const SUBMISSION_DETAIL_PAGE_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/operator-submissions/[id]/page.tsx"),
  "utf8"
);

// ── Submissions list page: no longer pre-filters the batch fetch by status ──

test("Submissions list page batches activation presentations for EVERY submission on the page, not just status==='approved' (the confirmed_auto visibility bug)", () => {
  assert.doesNotMatch(SUBMISSIONS_LIST_PAGE_SOURCE, /filter\(\(s\) => s\.status === "approved"\)/);
  assert.match(SUBMISSIONS_LIST_PAGE_SOURCE, /const submissionIds = submissions\.map\(\(s\) => s\.id\);/);
});

// ── Exported Server Action signature safety ─────────────────────────────────
//
// The single most important property this correction establishes: no
// exported "use server" action anywhere in these files accepts a
// dependency/test-override parameter. Checked two ways per action — (1) the
// exact fixed parameter list appears verbatim, and (2) broadly, that the
// word "deps" never appears anywhere in either "use server" wrapper file at
// all (the impl files are explicitly allowed to use it; they're checked
// separately, below, for having NO "use server" directive).

test("extendActivationDeadlineAction (exported wrapper) has the fixed signature (lifecycleId, prevState, formData) with no 4th deps parameter", () => {
  assert.match(EXTEND_WRAPPER_SOURCE, /"use server";/);
  assert.match(
    EXTEND_WRAPPER_SOURCE,
    /export async function extendActivationDeadlineAction\(\s*lifecycleId: string,\s*_prevState: ExtendDeadlineState,\s*_formData: FormData\s*\): Promise<ExtendDeadlineState> \{/
  );
  assert.doesNotMatch(EXTEND_WRAPPER_SOURCE, /\bdeps\b/, "the exported wrapper file must never mention `deps` at all");
});

test("extendActivationDeadlineImpl.ts has NO \"use server\" directive — it is never itself network-reachable, so its deps parameter is safe", () => {
  assert.doesNotMatch(EXTEND_IMPL_SOURCE, /"use server";/);
});

test("resendClaimSetupEmailAction (exported wrapper) has the fixed signature (claimId, prevState, formData) with no 4th deps parameter", () => {
  assert.match(CLAIMS_ACTIONS_SOURCE, /"use server";/);
  assert.match(
    CLAIMS_ACTIONS_SOURCE,
    /export async function resendClaimSetupEmailAction\(\s*claimId: string,\s*_prevState: ResendSetupEmailState,\s*_formData: FormData\s*\): Promise<ResendSetupEmailState> \{/
  );
});

test("resendClaimSetupEmailImpl.ts has NO \"use server\" directive — it is never itself network-reachable, so its deps parameter is safe", () => {
  assert.doesNotMatch(RESEND_CLAIM_IMPL_SOURCE, /"use server";/);
});

test("no exported function in either claims/[id]/actions.ts or operator-submissions/[id]/actions.ts declares a `deps` parameter", () => {
  // A deps-shaped override parameter would appear as a parameter named
  // `deps` on some exported async function — scan every exported function
  // signature block for the literal token.
  const exportedFnPattern = /export async function \w+\([\s\S]*?\): Promise<[^{]+>\s*\{/g;
  for (const [label, source] of [
    ["claims actions.ts", CLAIMS_ACTIONS_SOURCE] as const,
    ["submissions actions.ts", SUBMISSIONS_ACTIONS_SOURCE] as const,
  ]) {
    const matches = [...source.matchAll(exportedFnPattern)];
    assert.ok(matches.length > 0, `${label}: expected at least one exported action`);
    for (const match of matches) {
      assert.doesNotMatch(match[0], /\bdeps\s*:/, `${label}: an exported action's signature contains a deps parameter: ${match[0].slice(0, 120)}...`);
    }
  }
});

// ── extendActivationDeadlineImpl: founder-only ──────────────────────────────

test("extendActivationDeadlineImpl checks admin authorization (via isControlPanelAdmin, or an injected test double) before any read or write", () => {
  assert.match(EXTEND_IMPL_SOURCE, /deps\.checkAdmin \?\? isControlPanelAdmin/);
  const authIdx = EXTEND_IMPL_SOURCE.indexOf("checkAdmin(user.email)");
  const fetchIdx = EXTEND_IMPL_SOURCE.indexOf('.from("operator_activation_lifecycles")');
  assert.ok(authIdx !== -1 && fetchIdx !== -1);
  assert.ok(authIdx < fetchIdx, "authorization must be checked before touching the lifecycle table");
});

test("extendActivationDeadlineImpl's CAS also pins expired_at to the value read, using .eq() when set and .is(null) when null", () => {
  assert.match(EXTEND_IMPL_SOURCE, /baseUpdate\.eq\("expired_at", currentExpiredAt\)/);
  assert.match(EXTEND_IMPL_SOURCE, /baseUpdate\.is\("expired_at", null\)/);
});

test("extendActivationDeadlineImpl's note metadata preserves the prior expired_at (case C reopen) rather than discarding it", () => {
  assert.match(EXTEND_IMPL_SOURCE, /previousExpiredAt:\s*currentExpiredAt,/);
});

// ── extendActivationDeadlineImpl: guards ────────────────────────────────────

test("extendActivationDeadlineImpl blocks a released lifecycle before ever computing a new deadline", () => {
  const releasedGuardIdx = EXTEND_IMPL_SOURCE.indexOf("if (lifecycleRow.released_at)");
  const computeCallIdx = EXTEND_IMPL_SOURCE.indexOf("computeExtendedDeadline(currentDeadlineAt)");
  assert.ok(releasedGuardIdx !== -1 && computeCallIdx !== -1);
  assert.ok(releasedGuardIdx < computeCallIdx);
});

test("extendActivationDeadlineImpl blocks an already-activated operator before computing a new deadline", () => {
  const activatedGuardIdx = EXTEND_IMPL_SOURCE.indexOf("operatorRow?.account_activated_at");
  const computeCallIdx = EXTEND_IMPL_SOURCE.indexOf("computeExtendedDeadline(currentDeadlineAt)");
  assert.ok(activatedGuardIdx !== -1 && computeCallIdx !== -1);
  assert.ok(activatedGuardIdx < computeCallIdx);
});

test("extendActivationDeadlineImpl never writes released_at — extension can never reopen a released lifecycle", () => {
  const updateBlockIdx = EXTEND_IMPL_SOURCE.indexOf(".update({");
  const updateBlockEnd = EXTEND_IMPL_SOURCE.indexOf("})", updateBlockIdx);
  const updateBlock = EXTEND_IMPL_SOURCE.slice(updateBlockIdx, updateBlockEnd);
  assert.doesNotMatch(updateBlock, /released_at/);
});

// ── extendActivationDeadlineImpl: atomic compare-and-swap ───────────────────

test("extendActivationDeadlineImpl's update is pinned to the previously-read deadline AND released_at IS NULL — an atomic compare-and-swap", () => {
  const updateIdx = EXTEND_IMPL_SOURCE.indexOf(".update({");
  const block = EXTEND_IMPL_SOURCE.slice(updateIdx, updateIdx + 500);
  assert.match(block, /\.eq\("id", lifecycleId\)/);
  assert.match(block, /\.eq\("deadline_at", currentDeadlineAt\)/);
  assert.match(block, /\.is\("released_at", null\)/);
});

test("extendActivationDeadlineImpl treats zero matched rows as a concurrency conflict, not a silent success", () => {
  assert.match(EXTEND_IMPL_SOURCE, /if \(!updated\) \{/);
  const guardIdx = EXTEND_IMPL_SOURCE.indexOf("if (!updated) {");
  const block = EXTEND_IMPL_SOURCE.slice(guardIdx, guardIdx + 300);
  assert.match(block, /error:/);
  assert.doesNotMatch(block, /success: true/);
});

// ── extendActivationDeadlineImpl: structured note, real founder attribution ─

test("extendActivationDeadlineImpl writes a deadline_extended structured note attributed to the real signed-in founder, not the system author", () => {
  assert.match(EXTEND_IMPL_SOURCE, /event_type:\s*"deadline_extended"/);
  const noteBlockIdx = EXTEND_IMPL_SOURCE.indexOf("const notePayload = {");
  const block = EXTEND_IMPL_SOURCE.slice(noteBlockIdx, noteBlockIdx + 700);
  assert.match(block, /created_by:\s*user\.id,/);
  assert.match(block, /created_by_email:\s*user\.email/);
  assert.doesNotMatch(block, /SYSTEM_AUTHOR_EMAIL/);
  assert.doesNotMatch(EXTEND_IMPL_SOURCE, /import.*writeActivationNote/);
});

test("extendActivationDeadlineImpl's note metadata never contains a link/token/credential", () => {
  const metaIdx = EXTEND_IMPL_SOURCE.indexOf("metadata_json: {");
  const block = EXTEND_IMPL_SOURCE.slice(metaIdx, EXTEND_IMPL_SOURCE.indexOf("},", metaIdx));
  assert.doesNotMatch(block, /token|link|password|secret/i);
});

// ── Resend hardening (both flows): unactivated + lifecycle checks ──────────
//
// Claims' logic now lives in resendClaimSetupEmailImpl.ts; submissions'
// stays inline in operator-submissions/[id]/actions.ts (no impl-file split
// was needed there — see activationPresentation.test.ts for how its
// eligibility logic is tested instead, via a pure predicate).

// Submissions' resend function body, isolated from the rest of
// operator-submissions/[id]/actions.ts (which legitimately contains OTHER
// functions — approveAndCreateVenueAction, resolveExistingVenueMatchAction —
// that DO call provisionOperatorForVenue/claimOrReuseActivationLifecycle;
// those calls must not make this test wrongly fail).
const SUBMISSION_RESEND_FN_START = SUBMISSIONS_ACTIONS_SOURCE.indexOf(
  "export async function resendSubmissionSetupEmailAction"
);
const SUBMISSION_RESEND_FN_END = SUBMISSIONS_ACTIONS_SOURCE.indexOf(
  "\n// ── Append internal note",
  SUBMISSION_RESEND_FN_START
);
const SUBMISSION_RESEND_SOURCE = SUBMISSIONS_ACTIONS_SOURCE.slice(
  SUBMISSION_RESEND_FN_START,
  SUBMISSION_RESEND_FN_END === -1 ? undefined : SUBMISSION_RESEND_FN_END
);

test("resend logic setup: the isolated submission-resend function slice actually contains the function (sanity check for the other tests using it)", () => {
  assert.ok(SUBMISSION_RESEND_FN_START !== -1, "resendSubmissionSetupEmailAction must exist");
  assert.match(SUBMISSION_RESEND_SOURCE, /export async function resendSubmissionSetupEmailAction/);
});

test("resend logic (claims): confirms the operator is still unactivated before generating a new link", () => {
  const activatedCheckIdx = RESEND_CLAIM_IMPL_SOURCE.indexOf("This operator has already activated their account");
  const generateLinkIdx = RESEND_CLAIM_IMPL_SOURCE.indexOf("auth.admin.generateLink({");
  assert.ok(activatedCheckIdx !== -1 && generateLinkIdx !== -1, "claims: both markers must exist");
  assert.ok(activatedCheckIdx < generateLinkIdx, "claims: activation check must precede link generation");
});

test("resend logic (submissions): eligibility (which folds in the unactivated check via presentation.state === 'active') is evaluated before generating a new link", () => {
  const eligibilityIdx = SUBMISSION_RESEND_SOURCE.indexOf("evaluateSubmissionResendEligibility(");
  const generateLinkIdx = SUBMISSION_RESEND_SOURCE.indexOf("auth.admin.generateLink({");
  assert.ok(eligibilityIdx !== -1 && generateLinkIdx !== -1, "submissions: both markers must exist");
  assert.ok(eligibilityIdx < generateLinkIdx, "submissions: eligibility check must precede link generation");
});

for (const [label, source] of [
  ["claims", RESEND_CLAIM_IMPL_SOURCE] as const,
  ["submissions", SUBMISSION_RESEND_SOURCE] as const,
]) {
  test(`resend logic (${label}): writes a structured manual_resend note attributed to the real founder, and never stores the generated link`, () => {
    const noteBlockIdx = source.lastIndexOf('event_type:       "manual_resend"');
    assert.ok(noteBlockIdx !== -1, `${label}: manual_resend event_type must be written`);
    const block = source.slice(Math.max(0, noteBlockIdx - 200), noteBlockIdx + 400);
    assert.match(block, /created_by:\s*user\.id,/);
    assert.doesNotMatch(block, /action_link/);
  });

  test(`resend logic (${label}): never itself extends the deadline or creates a lifecycle/Auth user/operator`, () => {
    assert.doesNotMatch(source, /computeExtendedDeadline/, `${label}: resend must never itself extend the deadline`);
    assert.doesNotMatch(source, /provisionOperatorForVenue/, `${label}: resend must never provision a new operator`);
    assert.doesNotMatch(source, /claimOrReuseActivationLifecycle/, `${label}: resend must never create/claim a lifecycle`);
  });
}

test("resend logic (claims): blocks resend when the activation was already released", () => {
  assert.match(RESEND_CLAIM_IMPL_SOURCE, /presentation\.lifecycle\.releasedAt/);
});

test("resend logic (claims): requires the deadline to be extended first when it has already passed (never auto-extends)", () => {
  const pastDeadlineCheckIdx = RESEND_CLAIM_IMPL_SOURCE.indexOf(
    'presentation.state === "release_required" || presentation.state === "expired"'
  );
  assert.ok(pastDeadlineCheckIdx !== -1, "claims: past-deadline guard must exist");
});

// ── Submission resend: lifecycle-authoritative eligibility, exposed on the UI ─

test("resendSubmissionSetupEmailAction uses evaluateSubmissionResendEligibility() — lifecycle state, not a bare status check — as the eligibility gate", () => {
  assert.match(SUBMISSIONS_ACTIONS_SOURCE, /evaluateSubmissionResendEligibility\(/);
  assert.doesNotMatch(
    SUBMISSIONS_ACTIONS_SOURCE,
    /if \(\(sub\.status as string\) !== "approved"\)/,
    "the old status-only eligibility check must be gone"
  );
});

test("Submission detail page renders ResendSetupEmailPanel for any activation-relevant status, not only 'approved' — confirmed_auto is now included", () => {
  assert.doesNotMatch(SUBMISSION_DETAIL_PAGE_SOURCE, /submission\.status === "approved" &&\s*\(\s*<ResendSetupEmailPanel/);
  assert.match(SUBMISSION_DETAIL_PAGE_SOURCE, /ACTIVATION_RELEVANT_SUBMISSION_STATUSES\.has\(submission\.status\)/);
});

// ── ActivationNoteMeta metadata allowlist (Phase 1B correction) ─────────────

test("ActivationNoteMeta's allowlist displays the prior expired timestamp and the founder identity that extended the deadline", () => {
  const noteMetaSource = readFileSync(
    join(__dirname, "../../../src/components/ActivationNoteMeta.tsx"),
    "utf8"
  );
  assert.match(noteMetaSource, /previousExpiredAt:\s*"[^"]+"/);
  assert.match(noteMetaSource, /extendedByEmail:\s*"[^"]+"/);
});
