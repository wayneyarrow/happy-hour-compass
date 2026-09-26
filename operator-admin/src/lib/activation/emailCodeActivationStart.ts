import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { generateLinkWithRetry } from "@/lib/supabase/generateLinkWithRetry";
import { getSiteUrl } from "@/lib/siteUrl";
import { getOperatorVerificationCodeHmacSecret, isOperatorEmailCodeVerificationEnabled } from "./emailCodeVerificationConfig";
import {
  buildVerificationContinueUrl,
  buildVerificationPath,
  issueVerificationCodeForLifecycle,
  OPERATOR_CREATE_PASSWORD_PATH,
} from "./emailCodeVerificationService";
import { sendContinueSetupEmail, type ContinueSetupOrigin } from "./emailCodeVerificationEmails";
import type { ClaimActivationLifecycleResult } from "./activationLifecycle";

/**
 * The ONE decision point for whether a newly approved operator uses the
 * email-code activation flow (email-code initiative, Phase 2B), plus the
 * post-lifecycle delivery step that replaces the legacy setup email for
 * those operators. Shared by all four provisionOperatorForVenue() call
 * sites (claim approval, both submission approvals, and the in-flow
 * auto-confirmed Add Your Venue submission).
 *
 * FLAG OFF (the Production state): planActivationVerificationMode()
 * returns "legacy" before any read, every caller passes the exact legacy
 * arguments to provisionOperatorForVenue()/claimOrReuseActivationLifecycle(),
 * and deliverDeferredActivationStart() is never reached — behavior is
 * byte-for-byte the pre-Phase-2B flow.
 *
 * FLAG ON: a genuinely new operator's setup email is deferred out of
 * provisioning (no Supabase recovery link is even generated), the lifecycle
 * is created with verification_required = true, and once it exists this
 * module either emails a continue-setup link (founder approvals) or issues
 * the first code and hands back the in-app verify path (in-flow submission).
 *
 * The flag only ever affects NEW lifecycles. Existing lifecycles keep the
 * mode they were created with, whatever the flag later says — see
 * emailCodeVerificationService.ts's readLifecycleVerificationRequired().
 */

export type ActivationVerificationPlan = "legacy" | "email_code";

export type PlanActivationVerificationDeps = {
  adminClient?: SupabaseClient;
  isEnabled?: () => boolean;
  secret?: string | null;
};

/**
 * Decides the flow BEFORE provisioning, because provisioning is where the
 * legacy email is sent. Anything uncertain resolves to "legacy" — the
 * existing, proven path — never to a half-configured email-code flow:
 *   - flag off → legacy (no reads at all)
 *   - HMAC secret missing/weak → legacy (and logged: misconfiguration)
 *   - operator already activated → legacy (the unchanged returning-
 *     operator "venue added" email; no lifecycle is created for them)
 *   - operator already has a live lifecycle → that lifecycle's own mode
 *     (claimOrReuseActivationLifecycle() will reuse it, never replace it)
 *   - any read error → legacy
 */
export async function planActivationVerificationMode(
  { email }: { email: string },
  deps: PlanActivationVerificationDeps = {}
): Promise<ActivationVerificationPlan> {
  const enabled = (deps.isEnabled ?? isOperatorEmailCodeVerificationEnabled)();
  if (!enabled) return "legacy";

  const secret = deps.secret !== undefined ? deps.secret : getOperatorVerificationCodeHmacSecret();
  if (!secret) {
    console.error(
      "[emailCodeActivation] OPERATOR_EMAIL_CODE_VERIFICATION_ENABLED is on but the HMAC secret is missing or too short — using the legacy setup-link flow."
    );
    return "legacy";
  }

  const admin = deps.adminClient ?? (createAdminClient() as unknown as SupabaseClient);
  const { data: operator, error } = await admin
    .from("operators")
    .select("id, account_activated_at")
    .eq("email", email)
    .maybeSingle();
  if (error) return "legacy";
  if (operator?.account_activated_at) return "legacy";

  if (operator?.id) {
    const { data: live, error: liveError } = await admin
      .from("operator_activation_lifecycles")
      .select("verification_required")
      .eq("operator_id", operator.id as string)
      .is("expired_at", null)
      .is("released_at", null)
      .maybeSingle();
    if (liveError) return "legacy";
    if (live) return live.verification_required === true ? "email_code" : "legacy";
  }

  return "email_code";
}

export type DeferredActivationResult =
  /** Founder approval: continue-setup email (link to /operator/verify) sent. */
  | { kind: "continue_email_sent" }
  /** In-flow submission: first code issued (or attempted); redirect the browser here. */
  | { kind: "code_issued"; verificationPath: string }
  /** The lifecycle turned out to be legacy (reused) or couldn't be created — legacy setup email sent instead. */
  | { kind: "legacy_fallback_sent" }
  /** Operator activated in the meantime — nothing to send. */
  | { kind: "nothing_to_send" }
  | { kind: "failed"; error: string };

export type DeliverDeferredActivationDeps = {
  adminClient?: SupabaseClient;
  secret?: string | null;
  siteUrl?: string;
  sendContinueEmail?: typeof sendContinueSetupEmail;
  issueCode?: typeof issueVerificationCodeForLifecycle;
  generateLink?: typeof generateLinkWithRetry;
};

/**
 * Runs AFTER claimOrReuseActivationLifecycle(), only for a provisioning
 * call whose setup email was deferred. Sends exactly one thing:
 *
 *   verification-required lifecycle + founder approval → continue-setup email
 *   verification-required lifecycle + in-flow          → first code (email) + verify path
 *   anything else (a reused LEGACY lifecycle, or the lifecycle claim
 *     failed)                                          → the legacy setup email,
 *     exactly as provisioning would have sent it, so the operator is never
 *     left with no way in.
 *
 * Failures here never undo provisioning (the origin row is already
 * approved and the lifecycle, when it exists, is live): the founder can
 * Resend, and the reminder worker also reaches this operator.
 */
export async function deliverDeferredActivationStart(
  {
    lifecycleResult,
    delivery,
    origin,
    recipient,
    requestIp = null,
    logTag,
    sendLegacySetupEmail,
  }: {
    lifecycleResult: ClaimActivationLifecycleResult;
    delivery: "email_link" | "in_flow";
    origin: ContinueSetupOrigin;
    recipient: { email: string; firstName: string | null | undefined };
    requestIp?: string | null;
    logTag: string;
    /** The exact legacy email this call site would have sent from provisioning. */
    sendLegacySetupEmail: (setupLink: string) => Promise<{ ok: boolean; error?: string }>;
  },
  deps: DeliverDeferredActivationDeps = {}
): Promise<DeferredActivationResult> {
  const admin = deps.adminClient ?? (createAdminClient() as unknown as SupabaseClient);
  const secret = deps.secret !== undefined ? deps.secret : getOperatorVerificationCodeHmacSecret();
  const siteUrl = deps.siteUrl ?? getSiteUrl();

  if (lifecycleResult.decision === "already_activated") {
    console.warn(`${logTag} Operator activated before the deferred setup email was sent — nothing to send.`);
    return { kind: "nothing_to_send" };
  }

  const lifecycle =
    lifecycleResult.decision === "started" || lifecycleResult.decision === "reused" ? lifecycleResult.lifecycle : null;

  if (lifecycle?.verificationRequired && secret) {
    if (delivery === "in_flow") {
      const verificationPath = buildVerificationPath(lifecycle.id, secret);
      if (verificationPath) {
        // The page reflects whatever happened here (sent, cooldown from a
        // concurrent request, or send_failed with a resend button) — the
        // redirect happens regardless, so the operator stays in the flow.
        await (deps.issueCode ?? issueVerificationCodeForLifecycle)(lifecycle.id, { requestIp }, { adminClient: admin, secret });
        return { kind: "code_issued", verificationPath };
      }
    } else {
      const continueUrl = buildVerificationContinueUrl(lifecycle.id, { secret, siteUrl });
      if (continueUrl) {
        const sent = await (deps.sendContinueEmail ?? sendContinueSetupEmail)({
          to: recipient.email,
          firstName: recipient.firstName,
          origin,
          continueUrl,
        });
        if (sent.ok) return { kind: "continue_email_sent" };
        console.error(`${logTag} Continue-setup email failed.`, { lifecycleId: lifecycle.id, error: sent.error });
        return { kind: "failed", error: sent.error ?? "Continue-setup email failed." };
      }
    }
  }

  // Legacy fallback — reused legacy lifecycle, failed lifecycle claim, or
  // (defensively) a secret that vanished between plan and delivery.
  const { data, error } = await (deps.generateLink ?? generateLinkWithRetry)(admin, {
    type: "recovery",
    email: recipient.email,
    options: { redirectTo: `${siteUrl}${OPERATOR_CREATE_PASSWORD_PATH}` },
  });
  if (error || !data?.properties?.action_link) {
    console.error(`${logTag} Legacy fallback setup link generation failed.`, { error: error?.message });
    return { kind: "failed", error: error?.message ?? "Setup link generation failed." };
  }
  const sent = await sendLegacySetupEmail(data.properties.action_link);
  if (!sent.ok) {
    console.error(`${logTag} Legacy fallback setup email failed.`, { error: sent.error });
    return { kind: "failed", error: sent.error ?? "Setup email failed." };
  }
  return { kind: "legacy_fallback_sent" };
}
