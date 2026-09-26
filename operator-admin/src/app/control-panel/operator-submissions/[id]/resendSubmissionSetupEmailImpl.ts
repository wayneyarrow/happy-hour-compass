import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { sendOperatorActivationEmail } from "@/lib/email";
import {
  buildVerificationContinueUrl,
  readLifecycleVerificationRequired,
} from "@/lib/activation/emailCodeVerificationService";
import { sendContinueSetupEmail } from "@/lib/activation/emailCodeVerificationEmails";
import { getSiteUrl } from "@/lib/siteUrl";
import {
  getActivationPresentationForSubmission,
  evaluateSubmissionResendEligibility,
} from "@/lib/activation/activationPresentation";

/**
 * Implementation for resendSubmissionSetupEmailAction, deliberately kept OUT
 * of the "use server" actions.ts file — same DI-boundary pattern as
 * resendClaimSetupEmailImpl.ts (Phase 1B correction), applied here as part
 * of the Phase 1C QA correction so both resend flows carry identical
 * behavioral test coverage. See that file's header for the full "why" —
 * summary: an exported async function in a "use server" file is a real,
 * network-callable Server Action, so a `deps` override belongs on a plain,
 * never-network-reachable module instead. actions.ts's exported
 * `resendSubmissionSetupEmailAction` is now a thin, fixed-signature wrapper
 * that calls this with no `deps`.
 */

export type ResendSetupEmailState = {
  success?: true;
  successAction?: string;
  error?: string;
};

/** Test-only DI — real callers (the "use server" wrapper) always omit this. */
export type ResendSubmissionSetupEmailDeps = {
  authClient?: Awaited<ReturnType<typeof createClient>>;
  adminClient?: ReturnType<typeof createAdminClient>;
  checkAdmin?: (email: string | undefined) => Promise<boolean>;
  /** Email-code (Phase 2B) seams — tests only; real callers never pass these. */
  sendContinueEmail?: typeof sendContinueSetupEmail;
  buildContinueUrl?: (lifecycleId: string) => string | null;
};

/**
 * Resends the "set up your account" email to an operator whose submission was
 * approved and whose account was provisioned.
 *
 * Safe to call multiple times — generates a fresh Supabase recovery link each
 * time. Does NOT create a new auth user, a new operator row, or alter venue
 * ownership. Appends an internal note on success.
 *
 * Eligibility: submission.status is confirmed_auto or approved, operator_id
 * is set, AND a live, unreleased, not-yet-due activation lifecycle is
 * actually tracked for this submission (evaluateSubmissionResendEligibility)
 * — an untracked submission is refused; use the controlled legacy-resume
 * flow instead (see legacyActivationResumeImpl.ts).
 */
export async function resendSubmissionSetupEmailImpl(
  submissionId: string,
  deps: ResendSubmissionSetupEmailDeps = {}
): Promise<ResendSetupEmailState> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authClient = deps.authClient ?? (await createClient());
  const { data: { user } } = await authClient.auth.getUser();
  const checkAdmin = deps.checkAdmin ?? isControlPanelAdmin;
  if (!user || !(await checkAdmin(user.email))) return { error: "Unauthorized." };

  const supabase = deps.adminClient ?? createAdminClient();

  // ── Fetch submission ──────────────────────────────────────────────────────
  const { data: subRaw, error: fetchError } = await supabase
    .from("operator_submissions")
    .select("email, first_name, operator_id, status")
    .eq("id", submissionId)
    .single();

  if (fetchError || !subRaw) {
    console.error("[resendSubmissionSetupEmailImpl] Fetch failed:", fetchError?.message);
    return { error: "Submission not found. Please refresh and try again." };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sub = subRaw as any as Record<string, unknown>;

  const email      = sub.email as string;
  const firstName  = ((sub.first_name as string | null) ?? "").trim() || "there";
  const operatorId = sub.operator_id as string | null;

  if (!email) return { error: "Submission has no email address." };
  if (!operatorId) {
    return {
      error:
        "No operator account is linked to this submission. " +
        "The submission may not have been fully provisioned.",
    };
  }

  // ── Eligibility — the authoritative activation lifecycle, not the routing
  // status label (Phase 1B), and now also refusing an untracked lifecycle
  // outright (Phase 1C QA correction) — see evaluateSubmissionResendEligibility
  // for the full rule. Passing `supabase` here (previously omitted) ensures a
  // caller-injected adminClient is actually honored — the presentation lookup
  // no longer silently falls back to a real, un-injectable admin client under
  // test DI.
  const presentation = await getActivationPresentationForSubmission(submissionId, supabase);
  const eligibility = evaluateSubmissionResendEligibility(sub.status as string, presentation);
  if (!eligibility.eligible) {
    return { error: eligibility.reason };
  }

  // ── Double-submit guard ──────────────────────────────────────────────────
  // Same idiom as resendClaimSetupEmailImpl / reviewSubmissionAction's
  // needs_more_info RETRY_WINDOW_MS guard — no dedicated "last resend"
  // column exists, so the structured manual_resend note this action
  // already writes on success is reused as the signal.
  const RETRY_WINDOW_MS = 10_000;
  const { data: recentResendNotes } = await supabase
    .from("operator_submission_notes")
    .select("created_at")
    .eq("submission_id", submissionId)
    .eq("event_type", "manual_resend")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastResendAt = recentResendNotes?.[0]?.created_at as string | undefined;
  if (lastResendAt && Date.now() - new Date(lastResendAt).getTime() < RETRY_WINDOW_MS) {
    console.warn("[resendSubmissionSetupEmailImpl] Duplicate resend suppressed (retry window).", { submissionId });
    return { success: true, successAction: `Setup email resent to ${email}` };
  }

  // ── Email-code lifecycle? (Phase 2B) ──────────────────────────────────────
  // A verification-required lifecycle gets the continue-setup email (link to
  // the /operator/verify code screen) — never a Supabase recovery link, which
  // would skip the required code step. Legacy lifecycles take the unchanged
  // path below.
  const lifecycleId = presentation.lifecycle?.id ?? null;
  const mode = lifecycleId
    ? await readLifecycleVerificationRequired(supabase, lifecycleId)
    : ({ ok: true, verificationRequired: false } as const);
  if (!mode.ok) {
    console.error("[resendSubmissionSetupEmailImpl] Lifecycle verification-mode lookup failed:", mode.error);
    return { error: "Could not load this operator's setup details. Please try again." };
  }

  let emailResult: { ok: boolean; error?: string };
  if (mode.verificationRequired && lifecycleId) {
    const continueUrl = (deps.buildContinueUrl ?? ((id: string) => buildVerificationContinueUrl(id)))(lifecycleId);
    if (!continueUrl) {
      console.error("[resendSubmissionSetupEmailImpl] Email-code verification link unavailable (HMAC secret not configured).", { lifecycleId });
      return { error: "Email-code verification is not configured, so the setup email can't be sent. Please contact support." };
    }
    emailResult = await (deps.sendContinueEmail ?? sendContinueSetupEmail)({ to: email, firstName, origin: "submission", continueUrl });
  } else {
    // ── Generate fresh recovery link ──────────────────────────────────────────
    const appUrl     = getSiteUrl();
    const redirectTo = `${appUrl}/operator/create-password`;

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type:    "recovery",
      email,
      options: { redirectTo },
    });

    if (linkError || !linkData?.properties?.action_link) {
      console.error("[resendSubmissionSetupEmailImpl] generateLink failed:", linkError?.message);
      return { error: "Failed to generate a new setup link. Please try again." };
    }

    // ── Send email (awaited — fail fast on error) ─────────────────────────────
    emailResult = await sendOperatorActivationEmail({
      to:        email,
      firstName,
      setupLink: linkData.properties.action_link,
    });
  }

  if (!emailResult.ok) {
    console.error(
      "[resendSubmissionSetupEmailImpl] Email send failed:",
      { submissionId, email, error: emailResult.error }
    );
    return {
      error: `Email could not be sent to ${email} (${emailResult.error ?? "unknown error"}). Please try again.`,
    };
  }

  // ── Append structured internal note ───────────────────────────────────────
  // Founder-triggered, so attributed to the real signed-in founder — never
  // the "Happy Hour Compass" system-author string. Never stores the
  // generated link/token itself — only operational metadata.
  await supabase.from("operator_submission_notes").insert({
    submission_id:    submissionId,
    note:             `Setup email resent to ${email} by founder.`,
    event_type:       "manual_resend",
    metadata_json: {
      recipient: email,
      sentAt: new Date().toISOString(),
      lifecycleId: presentation.lifecycle?.id ?? null,
      currentDeadline: presentation.lifecycle?.deadlineAt ?? null,
    },
    created_by:       user.id,
    created_by_email: user.email ?? null,
  });

  console.log("[resendSubmissionSetupEmailImpl] Complete.", { submissionId, email });

  return { success: true, successAction: `Setup email resent to ${email}` };
}
