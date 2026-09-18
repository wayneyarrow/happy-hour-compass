import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { sendPasswordSetupEmail, sendOperatorActivationEmail } from "@/lib/email";
import { sendSlackAlert } from "@/lib/slack";
import { getSiteUrl } from "@/lib/siteUrl";
import { claimOrReuseActivationLifecycle } from "@/lib/activation/activationLifecycle";
import {
  resolveLegacyClaimActivationOrigin,
  resolveLegacySubmissionActivationOrigin,
  evaluateLegacyClaimActivationEligibility,
  evaluateLegacySubmissionActivationEligibility,
  type ResolvedLegacyActivationOrigin,
} from "@/lib/activation/activationPresentation";

/**
 * Implementation for the Phase 1C controlled legacy-activation-resume
 * Server Actions, deliberately kept OUT of the "use server"
 * legacyActivationResumeActions.ts file — same pattern, same rationale, as
 * resendClaimSetupEmailImpl.ts / extendActivationDeadlineImpl.ts (the Phase
 * 1B correction): this file has NO "use server" directive, so it is never
 * itself a network-callable Server Action, however it's exported. That's
 * where the dependency-injection seam for tests lives
 * (LegacyActivationResumeDeps) — real callers (the two thin exported
 * wrappers) always omit it.
 *
 * NOT A BULK BACKFILL: this opts exactly one operator, via exactly one
 * explicitly-selected Claim or Submission, into activation tracking. It
 * never infers which operator/origin to act on from anything but the id the
 * founder is looking at.
 *
 * MANDATORY CONCURRENCY RULE: only decision === "started" from
 * claimOrReuseActivationLifecycle() may proceed to send an email or write a
 * note. A "reused" decision — whether it points at the SAME origin (a
 * retried/duplicate request) or a DIFFERENT one (the operator already has a
 * live lifecycle elsewhere) — never sends an email and never writes a note.
 * The database's own partial unique indexes guarantee at most one of any
 * number of simultaneous attempts can ever receive "started" — every other
 * caller, no matter how many, gets "reused" and stays a strict no-op past
 * that point.
 *
 * WHAT THIS RULE DOES AND DOES NOT COVER — stated precisely, not as a
 * blanket "duplicate-safe" claim:
 *   - It DOES prevent duplicate email ATTEMPTS from two or more concurrent
 *     resume requests (see the concurrency tests) and from a normal
 *     sequential retry of THIS action (a second call to
 *     resumeLegacyClaimActivationImpl()/resumeLegacySubmissionActivationImpl()
 *     for an origin that already has a lifecycle always gets blocked or
 *     "reused", never a second "started").
 *   - It does NOT prove whether Resend actually accepted/delivered the one
 *     email this action DID attempt, when Resend's own response is
 *     ambiguous or times out on our side. If that happens, this action
 *     reports failure and tells the founder to use the existing Resend
 *     action — but Resend is a wholly separate code path with no knowledge
 *     of this decision, so if the original, ambiguously-reported attempt
 *     actually WAS delivered, that later manual Resend could still produce
 *     a real duplicate email to the operator. This is a narrow external-
 *     provider delivery-confirmation gap, not a defect in this action's own
 *     concurrency handling — see the task report for why a provider-level
 *     idempotency key was inspected and deliberately not added in this
 *     phase (email.ts's sendTransactionalEmail() already supports one, but
 *     wiring it through was out of this phase's scope, and the started-only
 *     rule above already fully covers the concurrency risk this phase's
 *     tests actually exercise).
 *
 * NO TRANSACTION SPANS THESE STEPS: the atomic lifecycle claim, the setup
 * email send, and the note insert are three separate network round trips,
 * not one database transaction. Each step's own failure is handled
 * explicitly below — see the inline comments at each step for the exact
 * compensating behavior, matching the task's failure-mode table.
 */

export type LegacyActivationResumeState = {
  success?: true;
  successAction?: string;
  error?: string;
};

type SendSetupEmailFn = (args: {
  to: string;
  firstName: string;
  setupLink: string;
}) => Promise<{ ok: boolean; error?: string }>;

/**
 * Test-only DI — real callers (the "use server" wrappers) always omit this.
 * `sendSetupEmail` exists specifically so tests can prove "exactly one email
 * attempt" without ever calling the real Resend SDK — this codebase has no
 * other seam for that (sendPasswordSetupEmail/sendOperatorActivationEmail
 * call the real provider directly), and this action's own task explicitly
 * forbids sending a real email during implementation or testing.
 */
export type LegacyActivationResumeDeps = {
  authClient?: Awaited<ReturnType<typeof createClient>>;
  adminClient?: ReturnType<typeof createAdminClient>;
  checkAdmin?: (email: string | undefined) => Promise<boolean>;
  sendSetupEmail?: SendSetupEmailFn;
};

type Origin = { type: "claim"; claimId: string } | { type: "submission"; submissionId: string };

function originLabel(origin: Origin): string {
  return origin.type === "claim" ? `claim ${origin.claimId}` : `submission ${origin.submissionId}`;
}

async function resumeLegacyActivation(
  origin: Origin,
  deps: LegacyActivationResumeDeps
): Promise<LegacyActivationResumeState> {
  // ── 1. Authorize founder — before ANY claim/submission/operator/recipient
  // detail is fetched or could be returned. Generic denial, matching every
  // other founder-only action in this codebase. ────────────────────────────
  const authClient = deps.authClient ?? (await createClient());
  const { data: { user } } = await authClient.auth.getUser();
  const checkAdmin = deps.checkAdmin ?? isControlPanelAdmin;
  if (!user || !(await checkAdmin(user.email))) {
    return { error: "Unauthorized." };
  }

  const supabase = deps.adminClient ?? createAdminClient();

  // ── 2-5. Fetch + revalidate origin/operator/venue linkage, fresh — never
  // trusts anything the page rendered. This ALSO independently re-confirms
  // the operator is still unactivated: if account_activated_at was set
  // between page render and this submission (by any means — the operator
  // completing setup via a different, already-delivered link, for
  // instance), this resolve step reads that fresh value and the eligibility
  // check below fails cleanly with no side effect. ─────────────────────────
  const resolved: ResolvedLegacyActivationOrigin =
    origin.type === "claim"
      ? await resolveLegacyClaimActivationOrigin(origin.claimId, supabase)
      : await resolveLegacySubmissionActivationOrigin(origin.submissionId, supabase);

  if (!resolved.found) {
    return { error: origin.type === "claim" ? "Claim not found. Please refresh and try again." : "Submission not found. Please refresh and try again." };
  }

  const eligibilityCheck = {
    originStatus: resolved.originStatus as string,
    operatorId: resolved.operatorId,
    operatorAccountActivatedAt: resolved.operatorAccountActivatedAt,
    originHasAnyLifecycle: resolved.originHasAnyLifecycle,
    operatorHasLiveLifecycleElsewhere: resolved.operatorHasLiveLifecycleElsewhere,
  };
  const eligibility =
    origin.type === "claim"
      ? evaluateLegacyClaimActivationEligibility(eligibilityCheck)
      : evaluateLegacySubmissionActivationEligibility(eligibilityCheck);

  if (!eligibility.eligible) {
    return { error: eligibility.reason };
  }

  const operatorId = resolved.operatorId as string; // non-null: guaranteed by eligibility check above
  const email = resolved.operatorEmail;
  const firstName = (resolved.operatorFirstName ?? "").trim() || "there";

  if (!email) {
    return { error: "This operator has no email address on file — cannot send a setup email." };
  }

  // ── 6. Atomic claim — the ONLY atomicity boundary in this whole action.
  // Never creates a second Auth user/operator/venue link/claim/submission;
  // this only ever writes to operator_activation_lifecycles. ───────────────
  const lifecycleResult = await claimOrReuseActivationLifecycle(
    {
      operatorId,
      origin,
      logTag: "[legacyActivationResumeImpl]",
    },
    supabase
  );

  // ── 7. Interpret the result explicitly. ───────────────────────────────────
  if (lifecycleResult.decision === "already_activated") {
    // The narrow race: operator activated between step 2-5's fresh read and
    // this INSERT attempt. No email, no note — exactly the same outcome as
    // if step 3 had caught it a few milliseconds earlier.
    return { error: "This operator has already activated their account." };
  }

  if (lifecycleResult.decision === "claim_failed") {
    // claimOrReuseActivationLifecycle() has ALREADY reported this to Sentry
    // + #ops-critical internally (see its own header) — no duplicate alert
    // here. No email, no note.
    return { error: lifecycleResult.error };
  }

  if (lifecycleResult.decision === "reused") {
    // MANDATORY RULE: "reused" never sends an email and never writes a note,
    // regardless of which origin the winning row belongs to. Reporting that
    // THIS origin now owns the lifecycle would be false whenever it points
    // elsewhere — the origin's own Activation Card would still (correctly)
    // show whatever the winning lifecycle's real state is via the normal
    // presentation lookup, once the founder refreshes.
    const sameOrigin =
      origin.type === "claim"
        ? lifecycleResult.lifecycle.originClaimId === origin.claimId
        : lifecycleResult.lifecycle.originSubmissionId === origin.submissionId;

    return {
      error: sameOrigin
        ? "Activation tracking was already started for this record. Please refresh to see the current state."
        : "This operator already has an active tracking window under a different Claim or Submission. Please refresh to see the current state.",
    };
  }

  // decision === "started" — this call, and only this call, may proceed.
  const lifecycle = lifecycleResult.lifecycle;

  // ── 8. Generate the setup link and send the email — ONLY reachable when
  // this call won the atomic claim. ─────────────────────────────────────────
  const appUrl = getSiteUrl();
  const redirectTo = `${appUrl}/operator/create-password`;

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error("[legacyActivationResumeImpl] generateLink failed after lifecycle started.", {
      origin: originLabel(origin),
      lifecycleId: lifecycle.id,
      error: linkError?.message,
    });
    await sendSlackAlert({
      channel: "ops-critical",
      severity: "critical",
      title: "Legacy Activation Resume — Lifecycle Started But Setup Link Could Not Be Generated",
      message:
        "A founder started controlled legacy activation tracking and the lifecycle row now exists " +
        "with a real 14-day deadline, but no setup link could be generated, so no email was sent. " +
        "The lifecycle is intentionally NOT deleted or reverted — use the existing Resend action once " +
        "the underlying issue is fixed.",
      metadata: {
        Origin: originLabel(origin),
        "Lifecycle ID": lifecycle.id,
        "Operator ID": operatorId,
        Recipient: email,
        Error: linkError?.message ?? "unknown",
      },
    });
    return {
      error:
        "Activation tracking has started (a 14-day deadline now exists), but the setup link could not " +
        "be generated. Please refresh the page and use the Resend action to retry delivery.",
    };
  }

  const sendSetupEmail: SendSetupEmailFn =
    deps.sendSetupEmail ?? (origin.type === "claim" ? sendPasswordSetupEmail : sendOperatorActivationEmail);
  const emailResult = await sendSetupEmail({ to: email, firstName, setupLink: linkData.properties.action_link });

  if (!emailResult.ok) {
    // ── Lifecycle starts but email fails: keep the lifecycle (never delete,
    // expire, or release it to "undo" this — it's a real, legitimate 14-day
    // clock now). No success note. Log + ops-critical alert. Tell the
    // founder to use the existing Resend action after refreshing. ──────────
    console.error("[legacyActivationResumeImpl] Email send failed after lifecycle started.", {
      origin: originLabel(origin),
      lifecycleId: lifecycle.id,
      email,
      error: emailResult.error,
    });
    await sendSlackAlert({
      channel: "ops-critical",
      severity: "critical",
      title: "Legacy Activation Resume — Lifecycle Started But Setup Email Failed",
      message:
        "A founder started controlled legacy activation tracking and the lifecycle row now exists " +
        "with a real 14-day deadline, but the setup email failed to send. The lifecycle is intentionally " +
        "NOT deleted or reverted — use the existing Resend action once delivery is confirmed working.",
      metadata: {
        Origin: originLabel(origin),
        "Lifecycle ID": lifecycle.id,
        "Operator ID": operatorId,
        Recipient: email,
        Error: emailResult.error ?? "unknown",
      },
    });
    return {
      error:
        `Activation tracking has started (a 14-day deadline now exists), but the setup email could not ` +
        `be sent to ${email} (${emailResult.error ?? "unknown error"}). Please refresh the page and use ` +
        "the Resend action to retry delivery.",
    };
  }

  // ── 9. Write exactly one structured, founder-attributed note — only after
  // successful delivery. Never the setup link/token/token hash. ────────────
  const notePayload = {
    note: `Activation tracking started (controlled legacy resume) — setup email sent to ${email} by founder.`,
    event_type: "legacy_activation_resumed",
    metadata_json: {
      lifecycleId: lifecycle.id,
      recipient: email,
      deadline: lifecycle.deadlineAt,
      flow: origin.type,
    },
    created_by: user.id,
    created_by_email: user.email ?? null,
  };

  const { error: noteError } =
    origin.type === "claim"
      ? await supabase.from("venue_claim_notes").insert({ claim_id: origin.claimId, ...notePayload })
      : await supabase.from("operator_submission_notes").insert({ submission_id: origin.submissionId, ...notePayload });

  if (noteError) {
    // Email + lifecycle both genuinely succeeded — never resend the email,
    // never roll back the lifecycle. Log + a (non-critical) alert so the
    // gap is visible, then still report operational success.
    console.error("[legacyActivationResumeImpl] Structured note failed after successful send.", {
      origin: originLabel(origin),
      lifecycleId: lifecycle.id,
      error: noteError.message,
    });
    await sendSlackAlert({
      channel: "ops-alerts",
      severity: "warning",
      title: "Legacy Activation Resume — Note Not Recorded",
      message:
        "Activation tracking started and the setup email was sent successfully, but the structured " +
        "Internal Note could not be recorded. No retry is needed — the lifecycle and email both " +
        "succeeded; this only means the audit trail is missing this one entry.",
      metadata: {
        Origin: originLabel(origin),
        "Lifecycle ID": lifecycle.id,
        Recipient: email,
        Error: noteError.message,
      },
    });
    return {
      success: true,
      successAction: `Activation tracking started — setup email sent to ${email} (Internal Note could not be recorded)`,
    };
  }

  return { success: true, successAction: `Activation tracking started — setup email sent to ${email}` };
}

/**
 * Starts controlled legacy activation tracking for a Claim's operator and
 * resends their setup email. See the module header for the full sequencing,
 * concurrency, and failure-mode rules.
 */
export async function resumeLegacyClaimActivationImpl(
  claimId: string,
  deps: LegacyActivationResumeDeps = {}
): Promise<LegacyActivationResumeState> {
  return resumeLegacyActivation({ type: "claim", claimId }, deps);
}

/**
 * Starts controlled legacy activation tracking for a Submission's operator
 * and resends their setup email. See the module header for the full
 * sequencing, concurrency, and failure-mode rules.
 */
export async function resumeLegacySubmissionActivationImpl(
  submissionId: string,
  deps: LegacyActivationResumeDeps = {}
): Promise<LegacyActivationResumeState> {
  return resumeLegacyActivation({ type: "submission", submissionId }, deps);
}
