import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-inspection tests for Phase 1B's founder-controls actions:
 *   - extendActivationDeadlineAction (exported wrapper) / extendActivationDeadlineImpl (real logic)
 *   - resendClaimSetupEmailAction (exported wrapper) / resendClaimSetupEmailImpl (real logic)
 *   - resendSubmissionSetupEmailAction (exported wrapper) / resendSubmissionSetupEmailImpl (real logic)
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
 *     resendSubmissionSetupEmailImpl.ts, extendActivationDeadlineImpl.ts) —
 *     never network-reachable, so `deps` there is safe. Behavioral tests
 *     import these directly (see activationLifecycleActionsBehavior.test.ts,
 *     resendClaimSetupEmailAuthorization.test.ts,
 *     resendSetupEmailLifecycleGate.test.ts).
 *   - The "use server" file keeps only a thin, FIXED-signature wrapper —
 *     `(id, prevState, formData)`, nothing else — that calls the impl with
 *     no `deps`. The tests below pin that this wrapper genuinely has no
 *     override surface.
 *
 * PHASE 1C QA CORRECTION (2026-09): resendSubmissionSetupEmailAction was
 * originally inline in actions.ts with no impl-file split (it never had a
 * `deps` parameter, so it wasn't a security defect the way the other two
 * were) — but staging QA found that BOTH resend flows could send a setup
 * email for a claim/submission with NO activation lifecycle tracked at all,
 * bypassing the controlled legacy-resume flow entirely. Fixing that
 * required a real, injectable Supabase client so the fix could be proven
 * behaviorally (not just via the pure evaluateSubmissionResendEligibility()
 * predicate), so resendSubmissionSetupEmailAction was split into the same
 * wrapper/impl shape as its Claim sibling at the same time.
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
const RESEND_SUBMISSION_IMPL_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/operator-submissions/[id]/resendSubmissionSetupEmailImpl.ts"),
  "utf8"
);
const SUBMISSIONS_ACTIONS_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/operator-submissions/[id]/actions.ts"),
  "utf8"
);
const CLAIM_DETAIL_PAGE_SOURCE = readFileSync(
  join(__dirname, "../../../src/app/control-panel/claims/[id]/page.tsx"),
  "utf8"
);
const ACTIVATION_PRESENTATION_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/activation/activationPresentation.ts"),
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
const LEGACY_RESUME_IMPL_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/activation/legacyActivationResumeImpl.ts"),
  "utf8"
);
const LEGACY_RESUME_WRAPPER_SOURCE = readFileSync(
  join(__dirname, "../../../src/lib/activation/legacyActivationResumeActions.ts"),
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

test("resendSubmissionSetupEmailAction (exported wrapper) has the fixed signature (submissionId, prevState, formData) with no 4th deps parameter", () => {
  assert.match(SUBMISSIONS_ACTIONS_SOURCE, /"use server";/);
  assert.match(
    SUBMISSIONS_ACTIONS_SOURCE,
    /export async function resendSubmissionSetupEmailAction\(\s*submissionId: string,\s*_prevState: ResendSetupEmailState,\s*_formData: FormData\s*\): Promise<ResendSetupEmailState> \{/
  );
});

test("resendSubmissionSetupEmailImpl.ts has NO \"use server\" directive — it is never itself network-reachable, so its deps parameter is safe", () => {
  assert.doesNotMatch(RESEND_SUBMISSION_IMPL_SOURCE, /"use server";/);
});

test("no exported function in either claims/[id]/actions.ts, operator-submissions/[id]/actions.ts, or legacyActivationResumeActions.ts declares a `deps` parameter", () => {
  // A deps-shaped override parameter would appear as a parameter named
  // `deps` on some exported async function — scan every exported function
  // signature block for the literal token.
  const exportedFnPattern = /export async function \w+\([\s\S]*?\): Promise<[^{]+>\s*\{/g;
  for (const [label, source] of [
    ["claims actions.ts", CLAIMS_ACTIONS_SOURCE] as const,
    ["submissions actions.ts", SUBMISSIONS_ACTIONS_SOURCE] as const,
    ["legacyActivationResumeActions.ts", LEGACY_RESUME_WRAPPER_SOURCE] as const,
  ]) {
    const matches = [...source.matchAll(exportedFnPattern)];
    assert.ok(matches.length > 0, `${label}: expected at least one exported action`);
    for (const match of matches) {
      assert.doesNotMatch(match[0], /\bdeps\s*:/, `${label}: an exported action's signature contains a deps parameter: ${match[0].slice(0, 120)}...`);
    }
  }
});

// ── Phase 1C: legacy activation resume — Server Action signature safety ────

test("resumeLegacyClaimActivationAction / resumeLegacySubmissionActionAction (exported wrappers) have fixed signatures with no deps parameter", () => {
  assert.match(LEGACY_RESUME_WRAPPER_SOURCE, /"use server";/);
  assert.match(
    LEGACY_RESUME_WRAPPER_SOURCE,
    /export async function resumeLegacyClaimActivationAction\(\s*claimId: string,\s*_prevState: LegacyActivationResumeState,\s*_formData: FormData\s*\): Promise<LegacyActivationResumeState> \{/
  );
  assert.match(
    LEGACY_RESUME_WRAPPER_SOURCE,
    /export async function resumeLegacySubmissionActivationAction\(\s*submissionId: string,\s*_prevState: LegacyActivationResumeState,\s*_formData: FormData\s*\): Promise<LegacyActivationResumeState> \{/
  );
  assert.doesNotMatch(LEGACY_RESUME_WRAPPER_SOURCE, /\bdeps\b/, "the exported wrapper file must never mention `deps` at all");
});

test("legacyActivationResumeImpl.ts has NO \"use server\" directive — it is never itself network-reachable, so its deps parameter (including sendSetupEmail) is safe", () => {
  assert.doesNotMatch(LEGACY_RESUME_IMPL_SOURCE, /"use server";/);
});

test("legacyActivationResumeActions.ts does not re-export the impl module (a bare re-export risks being swept into the \"use server\" transform)", () => {
  assert.doesNotMatch(LEGACY_RESUME_WRAPPER_SOURCE, /export\s*\{[^}]*resumeLegacy(Claim|Submission)ActivationImpl/);
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
  const computeCallIdx = EXTEND_IMPL_SOURCE.indexOf("computeExtendedDeadline(currentDeadlineAt, now)");
  assert.ok(releasedGuardIdx !== -1 && computeCallIdx !== -1);
  assert.ok(releasedGuardIdx < computeCallIdx);
});

test("extendActivationDeadlineImpl blocks an already-activated operator before computing a new deadline", () => {
  const activatedGuardIdx = EXTEND_IMPL_SOURCE.indexOf("operatorRow?.account_activated_at");
  const computeCallIdx = EXTEND_IMPL_SOURCE.indexOf("computeExtendedDeadline(currentDeadlineAt, now)");
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

test("extendActivationDeadlineImpl's update is pinned to the previously-read deadline, released_at IS NULL, AND reminder_lease_started_at IS NULL — an atomic compare-and-swap", () => {
  const updateIdx = EXTEND_IMPL_SOURCE.indexOf(".update({");
  const block = EXTEND_IMPL_SOURCE.slice(updateIdx, updateIdx + 500);
  assert.match(block, /\.eq\("id", lifecycleId\)/);
  assert.match(block, /\.eq\("deadline_at", currentDeadlineAt\)/);
  assert.match(block, /\.is\("released_at", null\)/);
  assert.match(block, /\.is\("reminder_lease_started_at", null\)/, "extension must never clear/steal an active reminder lease");
});

test("extendActivationDeadlineImpl treats zero matched rows as a concurrency conflict, not a silent success", () => {
  assert.match(EXTEND_IMPL_SOURCE, /if \(!updated\) \{/);
  const guardIdx = EXTEND_IMPL_SOURCE.indexOf("if (!updated) {");
  const block = EXTEND_IMPL_SOURCE.slice(guardIdx, guardIdx + 900);
  assert.match(block, /error:/);
  assert.doesNotMatch(block, /success: true/);
});

test("extendActivationDeadlineImpl distinguishes an active reminder lease from every other conflict with a distinct founder-facing message, and mutates nothing in that branch", () => {
  const guardIdx = EXTEND_IMPL_SOURCE.indexOf("if (!updated) {");
  const block = EXTEND_IMPL_SOURCE.slice(guardIdx, guardIdx + 900);
  assert.match(block, /reminder_lease_started_at/);
  assert.match(block, /A reminder is currently being processed\. Please refresh and try again shortly\./);
  assert.match(block, /changed by another action just now/);
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
// Claims' logic lives in resendClaimSetupEmailImpl.ts; submissions' now
// lives in the sibling resendSubmissionSetupEmailImpl.ts (Phase 1C QA
// correction — previously inline in actions.ts). Both delegate their
// lifecycle-state gate (no-lifecycle / released / release_required-or-
// expired / active) to the SHARED evaluateClaimResendEligibility() /
// evaluateSubmissionResendEligibility() predicates in
// activationPresentation.ts — see activationPresentation.test.ts for the
// pure-predicate behavioral coverage of those checks. The tests below only
// confirm each impl file actually CALLS its eligibility predicate before
// generateLink, and never re-implements the lifecycle-state logic inline.

test("resend logic (claims): confirms the operator is still unactivated before generating a new link", () => {
  const activatedCheckIdx = RESEND_CLAIM_IMPL_SOURCE.indexOf("This operator has already activated their account");
  const generateLinkIdx = RESEND_CLAIM_IMPL_SOURCE.indexOf("auth.admin.generateLink({");
  assert.ok(activatedCheckIdx !== -1 && generateLinkIdx !== -1, "claims: both markers must exist");
  assert.ok(activatedCheckIdx < generateLinkIdx, "claims: activation check must precede link generation");
});

test("resend logic (claims): evaluateClaimResendEligibility() is evaluated before generating a new link", () => {
  const eligibilityIdx = RESEND_CLAIM_IMPL_SOURCE.indexOf("evaluateClaimResendEligibility(");
  const generateLinkIdx = RESEND_CLAIM_IMPL_SOURCE.indexOf("auth.admin.generateLink({");
  assert.ok(eligibilityIdx !== -1 && generateLinkIdx !== -1, "claims: both markers must exist");
  assert.ok(eligibilityIdx < generateLinkIdx, "claims: eligibility check must precede link generation");
});

test("resend logic (submissions): evaluateSubmissionResendEligibility() is evaluated before generating a new link", () => {
  const eligibilityIdx = RESEND_SUBMISSION_IMPL_SOURCE.indexOf("evaluateSubmissionResendEligibility(");
  const generateLinkIdx = RESEND_SUBMISSION_IMPL_SOURCE.indexOf("auth.admin.generateLink({");
  assert.ok(eligibilityIdx !== -1 && generateLinkIdx !== -1, "submissions: both markers must exist");
  assert.ok(eligibilityIdx < generateLinkIdx, "submissions: eligibility check must precede link generation");
});

for (const [label, source] of [
  ["claims", RESEND_CLAIM_IMPL_SOURCE] as const,
  ["submissions", RESEND_SUBMISSION_IMPL_SOURCE] as const,
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

  test(`resend logic (${label}): passes its own (possibly injected) client into the presentation lookup, rather than always resolving a fresh real admin client`, () => {
    assert.match(
      source,
      /getActivationPresentationFor(Claim|Submission)\(\w+Id, supabase\)/,
      `${label}: the presentation lookup must be given the same client this impl is using (so test DI actually applies to it)`
    );
  });
}

// ── Shared resend eligibility gate (Phase 1C QA correction) ────────────────
//
// The actual lifecycle-state rules (no lifecycle / released / overdue /
// active) live once, in activationPresentation.ts's shared
// evaluateResendLifecycleGate() — both evaluateClaimResendEligibility() and
// evaluateSubmissionResendEligibility() delegate to it. See
// activationPresentation.test.ts for behavioral proof of each state.

test("evaluateClaimResendEligibility and evaluateSubmissionResendEligibility both delegate to one shared lifecycle-state gate — the rules are not duplicated per entity", () => {
  assert.match(ACTIVATION_PRESENTATION_SOURCE, /function evaluateResendLifecycleGate\(/);
  const claimFnIdx = ACTIVATION_PRESENTATION_SOURCE.indexOf("export function evaluateClaimResendEligibility(");
  const submissionFnIdx = ACTIVATION_PRESENTATION_SOURCE.indexOf("export function evaluateSubmissionResendEligibility(");
  assert.ok(claimFnIdx !== -1 && submissionFnIdx !== -1);
  const claimBlock = ACTIVATION_PRESENTATION_SOURCE.slice(claimFnIdx, claimFnIdx + 500);
  const submissionBlock = ACTIVATION_PRESENTATION_SOURCE.slice(submissionFnIdx, submissionFnIdx + 500);
  assert.match(claimBlock, /evaluateResendLifecycleGate\(/);
  assert.match(submissionBlock, /evaluateResendLifecycleGate\(/);
});

test("evaluateResendLifecycleGate refuses a record with no lifecycle at all — the actual Phase 1C QA bug", () => {
  const gateIdx = ACTIVATION_PRESENTATION_SOURCE.indexOf("function evaluateResendLifecycleGate(");
  const block = ACTIVATION_PRESENTATION_SOURCE.slice(gateIdx, gateIdx + 600);
  assert.match(block, /if \(!presentation\.lifecycle\)/);
  assert.match(block, /eligible: false/);
});

// ── Standalone resend panel visibility (Phase 1C QA correction) ────────────
//
// shouldShowStandaloneResendPanel() is the single, shared, pure predicate
// both detail pages use to decide whether to render the "Account recovery /
// Resend setup email" panel at all — see activationPresentation.test.ts for
// its behavioral coverage. These tests only confirm both pages actually use
// it (rather than the old ad hoc status-only conditions that caused the bug)
// and that legacy-resume is gated on the genuinely distinct "not_tracked"
// state, so the two affordances can never both render together.

test("Claim detail page gates the standalone resend panel on shouldShowStandaloneResendPanel(), not a bare claim.status check", () => {
  assert.doesNotMatch(CLAIM_DETAIL_PAGE_SOURCE, /claim\.status === "approved" &&\s*\(\s*<ResendSetupEmailPanel/);
  assert.match(CLAIM_DETAIL_PAGE_SOURCE, /shouldShowStandaloneResendPanel\(activationPresentation\)/);
});

test("Submission detail page gates the standalone resend panel on shouldShowStandaloneResendPanel(), not a bare activation-relevant-status check", () => {
  assert.doesNotMatch(SUBMISSION_DETAIL_PAGE_SOURCE, /ACTIVATION_RELEVANT_SUBMISSION_STATUSES\.has\(submission\.status\)\s*&&\s*\(\s*<ResendSetupEmailPanel/);
  assert.match(SUBMISSION_DETAIL_PAGE_SOURCE, /shouldShowStandaloneResendPanel\(rawActivationPresentation\)/);
});

for (const [label, source] of [
  ["Claim", CLAIM_DETAIL_PAGE_SOURCE] as const,
  ["Submission", SUBMISSION_DETAIL_PAGE_SOURCE] as const,
]) {
  test(`${label} detail page only computes legacyResume when state === "not_tracked" — never alongside a live/active lifecycle`, () => {
    assert.match(source, /if \(activationPresentation\?\.state === "not_tracked"\) \{/);
  });
}

// ── ActivationNoteMeta metadata allowlist (Phase 1B correction) ─────────────

test("ActivationNoteMeta's allowlist displays the prior expired timestamp and the founder identity that extended the deadline", () => {
  const noteMetaSource = readFileSync(
    join(__dirname, "../../../src/components/ActivationNoteMeta.tsx"),
    "utf8"
  );
  assert.match(noteMetaSource, /previousExpiredAt:\s*"[^"]+"/);
  assert.match(noteMetaSource, /extendedByEmail:\s*"[^"]+"/);
});

// ── Phase 1C: legacy activation resume — action ordering ───────────────────

test("legacyActivationResumeImpl checks admin authorization before any claim/submission/operator lookup", () => {
  const authIdx = LEGACY_RESUME_IMPL_SOURCE.indexOf("checkAdmin(user.email)");
  const resolveIdx = LEGACY_RESUME_IMPL_SOURCE.indexOf("resolveLegacyClaimActivationOrigin(origin.claimId, supabase)");
  assert.ok(authIdx !== -1 && resolveIdx !== -1);
  assert.ok(authIdx < resolveIdx, "authorization must be checked before any origin/operator lookup");
});

test("legacyActivationResumeImpl evaluates eligibility (including origin-has-any-lifecycle and live-elsewhere) before ever calling the atomic claim", () => {
  const eligibilityIdx = LEGACY_RESUME_IMPL_SOURCE.indexOf("if (!eligibility.eligible)");
  const claimIdx = LEGACY_RESUME_IMPL_SOURCE.indexOf("await claimOrReuseActivationLifecycle(");
  assert.ok(eligibilityIdx !== -1 && claimIdx !== -1);
  assert.ok(eligibilityIdx < claimIdx, "eligibility must be evaluated before the atomic claim");
});

test("legacyActivationResumeImpl only sends the setup email on decision === 'started' — reused (same or different origin) and claim_failed all return before reaching generateLink", () => {
  const source = LEGACY_RESUME_IMPL_SOURCE;
  const alreadyActivatedIdx = source.indexOf('if (lifecycleResult.decision === "already_activated")');
  const claimFailedIdx = source.indexOf('if (lifecycleResult.decision === "claim_failed")');
  const reusedIdx = source.indexOf('if (lifecycleResult.decision === "reused")');
  const generateLinkIdx = source.indexOf("supabase.auth.admin.generateLink(");
  assert.ok(alreadyActivatedIdx !== -1 && claimFailedIdx !== -1 && reusedIdx !== -1 && generateLinkIdx !== -1);
  assert.ok(alreadyActivatedIdx < generateLinkIdx && claimFailedIdx < generateLinkIdx && reusedIdx < generateLinkIdx);
  // Each of these three branches must return before falling through.
  for (const idx of [alreadyActivatedIdx, claimFailedIdx, reusedIdx]) {
    const block = source.slice(idx, idx + 800);
    assert.match(block, /return \{/, "each non-started branch must return immediately, never fall through to email/note");
  }
});

test("legacyActivationResumeImpl's reused branch never sends an email or writes a note, and reports different safe messages for same-origin vs different-origin", () => {
  const reusedIdx = LEGACY_RESUME_IMPL_SOURCE.indexOf('if (lifecycleResult.decision === "reused")');
  const nextBranchIdx = LEGACY_RESUME_IMPL_SOURCE.indexOf("// decision === \"started\"", reusedIdx);
  const block = LEGACY_RESUME_IMPL_SOURCE.slice(reusedIdx, nextBranchIdx === -1 ? reusedIdx + 1200 : nextBranchIdx);
  assert.doesNotMatch(block, /generateLink|sendSetupEmail|insert\(/);
  assert.match(block, /sameOrigin/);
  assert.match(block, /already started for this record/);
  assert.match(block, /active tracking window under a different Claim or Submission/);
});

test("legacyActivationResumeImpl writes the structured note only after a successful email send, never before", () => {
  const emailResultIdx = LEGACY_RESUME_IMPL_SOURCE.indexOf("if (!emailResult.ok)");
  const noteIdx = LEGACY_RESUME_IMPL_SOURCE.indexOf("const notePayload = {");
  assert.ok(emailResultIdx !== -1 && noteIdx !== -1);
  assert.ok(emailResultIdx < noteIdx, "the email-failure check must precede the note write");
});

test("legacyActivationResumeImpl's note is founder-attributed (real user), never the 'Happy Hour Compass' system author, and event_type is legacy_activation_resumed", () => {
  const noteIdx = LEGACY_RESUME_IMPL_SOURCE.indexOf("const notePayload = {");
  const block = LEGACY_RESUME_IMPL_SOURCE.slice(noteIdx, noteIdx + 500);
  assert.match(block, /event_type:\s*"legacy_activation_resumed"/);
  assert.match(block, /created_by:\s*user\.id,/);
  assert.match(block, /created_by_email:\s*user\.email/);
  assert.doesNotMatch(block, /SYSTEM_AUTHOR_EMAIL/);
  assert.doesNotMatch(LEGACY_RESUME_IMPL_SOURCE, /import.*writeActivationNote/);
});

test("legacyActivationResumeImpl's note metadata never contains a link/token/credential", () => {
  const metaIdx = LEGACY_RESUME_IMPL_SOURCE.indexOf("metadata_json: {");
  const block = LEGACY_RESUME_IMPL_SOURCE.slice(metaIdx, LEGACY_RESUME_IMPL_SOURCE.indexOf("},", metaIdx));
  assert.doesNotMatch(block, /token|link|password|secret/i);
});

test("legacyActivationResumeImpl never provisions a new Auth user/operator, never creates a venue link/claim/submission — it only ever touches operator_activation_lifecycles and the notes tables", () => {
  assert.doesNotMatch(LEGACY_RESUME_IMPL_SOURCE, /provisionOperatorForVenue/);
  assert.doesNotMatch(LEGACY_RESUME_IMPL_SOURCE, /auth\.admin\.createUser/);
  assert.doesNotMatch(LEGACY_RESUME_IMPL_SOURCE, /\.from\("venues"\)\.insert|\.from\("venue_claims"\)\.insert|\.from\("operator_submissions"\)\.insert/);
});

// ── Phase 1C: "Active — account activated before lifecycle tracking" ───────
// (Phase 1C QA correction: this branch now covers ANY active operator, with
// or without a lifecycle — an activated operator with a completed lifecycle
// has nothing left to track any more than a legacy one who activated before
// tracking ever existed. See ActivationCard.tsx's header comment on this
// branch.)

test("ActivationCard shows an 'Active' message for ANY activationState === \"active\" presentation, with or without a lifecycle — never 'Not tracked'", () => {
  const activationCardSource = readFileSync(join(__dirname, "../../../src/components/ActivationCard.tsx"), "utf8");
  assert.match(activationCardSource, /Active — account activated before lifecycle tracking/);
  assert.match(activationCardSource, /Active — account activated/);
  // The active branch must be its own top-level condition, checked before
  // the not-tracked (!lifecycle) branch — not folded into it, and not
  // conditioned on !lifecycle (that would wrongly exclude an active
  // operator whose lifecycle is still attached).
  assert.match(activationCardSource, /\{activationState === "active" \? \(/);
});

test("ActivationCard never renders Start-tracking/Resend/Extend/countdown affordances in the active branch, regardless of lifecycle presence", () => {
  const activationCardSource = readFileSync(join(__dirname, "../../../src/components/ActivationCard.tsx"), "utf8");
  const startIdx = activationCardSource.indexOf('{activationState === "active" ? (');
  const endIdx = activationCardSource.indexOf(") : !lifecycle ? (", startIdx);
  assert.ok(startIdx !== -1 && endIdx !== -1);
  const block = activationCardSource.slice(startIdx, endIdx);
  assert.doesNotMatch(block, /Start activation tracking/);
  assert.doesNotMatch(block, /Extend deadline/);
  assert.doesNotMatch(block, /formatDeadlineCountdown/);
  assert.doesNotMatch(block, /<form/);
});
