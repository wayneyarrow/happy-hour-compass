import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import {
  sendClaimNotificationEmail,
  sendClaimSubmissionConfirmationEmail,
  sendPasswordSetupEmail,
  sendVenueAddedToAccountEmail,
} from "@/lib/email";
import { provisionOperatorForVenue } from "@/lib/operatorActivation";
import { claimOrReuseActivationLifecycle } from "@/lib/activation/activationLifecycle";
import { writeActivationNote } from "@/lib/activation/activationNotes";
import { planActivationVerificationMode, deliverDeferredActivationStart } from "@/lib/activation/emailCodeActivationStart";
import { buildVerificationPath } from "@/lib/activation/emailCodeVerificationService";
import { gatherClaimSignals, type ClaimSignalInput } from "./claimAutoApprovalSignals";
import { evaluateClaimAutoApproval } from "./claimAutoApprovalPolicy";
import {
  claimAutoApprovalFallbackEventKey,
  claimAutoDecisionEventKey,
  claimSubmittedEventKey,
  isAutoApprovedClaim,
  writeClaimSystemNote,
} from "./claimAutoApprovalNotes";
import { sendAutoApprovedClaimNotifications } from "./claimAutoApprovalNotifications";
import { autoApprovedNoteText, autoDecisionMetadata } from "./claimAutoDecisionRecord";

/**
 * Claim auto-approval orchestration — runs inside submitClaimAction, only
 * when CLAIM_AUTO_APPROVAL_ENABLED is on, AFTER the claim row is inserted as
 * `pending` (so the existing one-pending-claim-per-venue index has already
 * serialized near-simultaneous claims).
 *
 *   gather signals → decide
 *     founder_review → claim stays pending; decision note; founder email +
 *                      Slack stating the exact reasons; claimant confirmation.
 *     auto_approved  → CAS claim pending→approved → provision with a
 *                      CONDITIONAL venue link (never overwrites a concurrent
 *                      owner) → lifecycle → first code via the shared in-flow
 *                      path → founder "CLAIM AUTO-APPROVED" email + Slack →
 *                      browser goes straight to /operator/verify.
 *
 * FAILURE SAFETY: every failure before the venue is linked reverts the
 * claim to `pending` (founder review) and says why, as a technical/ownership
 * reason — never as claimant risk. Once the venue is linked the claim stays
 * approved: ownership is valid, and the existing activation lifecycle,
 * reminders, founder Resend and Release cover anything after that.
 *
 * Reuses the email-code architecture as-is: planActivationVerificationMode,
 * provisionOperatorForVenue (+ two opt-in options), claimOrReuseActivationLifecycle,
 * deliverDeferredActivationStart({ delivery: "in_flow", origin: "claim" }),
 * /operator/verify, create-password, completeOperatorAccountActivation.
 */

export type ClaimFlowInput = ClaimSignalInput & {
  claimant: { firstName: string; lastName: string; email: string; phone: string; position: string };
  venueCity: string | null;
  submittedAt: string;
};

/**
 * How an APPROVED claim continues when the browser can't go straight to
 * /operator/verify (rare: e.g. the lifecycle had to reuse an older setup-link
 * activation, or code delivery couldn't start). "emailed" = setup
 * instructions were just sent; "pending_email" = none went out (the founder
 * is notified of the approval and can follow up). Either way the claim is
 * approved — the browser must never say it's awaiting review.
 */
export type ApprovedClaimSetup = "emailed" | "pending_email";

export type ClaimFlowResult =
  | { outcome: "auto_approved"; verificationPath?: string; nextPath?: "/login"; approvedSetup?: ApprovedClaimSetup }
  | { outcome: "founder_review" };

export type ClaimFlowDeps = {
  admin?: SupabaseClient;
  gather?: typeof gatherClaimSignals;
};

const LOG = "[claimAutoApproval]";

async function notifyFounderReview(
  input: ClaimFlowInput,
  reasons: string[],
  technicalFallback: boolean
): Promise<void> {
  try {
    const r = await sendClaimNotificationEmail({
      claimId: input.claim.id,
      venueName: input.venue.name,
      city: input.venueCity,
      firstName: input.claimant.firstName,
      lastName: input.claimant.lastName,
      claimantEmail: input.claimant.email,
      phone: input.claimant.phone,
      submittedAt: input.submittedAt,
      reviewReasons: { reasons, technicalFallback, role: input.claimant.position },
    });
    if (!r.ok) console.error(`${LOG} Founder review notification not-ok.`, { claimId: input.claim.id });
  } catch (err) {
    console.error(`${LOG} Founder review notification threw.`, err);
  }
}

async function confirmToClaimant(input: ClaimFlowInput): Promise<void> {
  try {
    await sendClaimSubmissionConfirmationEmail({
      to: input.claimant.email,
      firstName: input.claimant.firstName,
      venueName: input.venue.name,
    });
  } catch (err) {
    console.error(`${LOG} Claimant confirmation threw.`, err);
  }
}

/** Auto path could not complete: back to pending (if we moved it), say why, notify, confirm. */
async function fallBackToFounderReview(
  admin: SupabaseClient,
  input: ClaimFlowInput,
  why: string,
  { claimWasApproved, technicalFallback }: { claimWasApproved: boolean; technicalFallback: boolean }
): Promise<ClaimFlowResult> {
  if (claimWasApproved) {
    const { error } = await admin
      .from("venue_claims")
      .update({ status: "pending", reviewed_at: null })
      .eq("id", input.claim.id)
      .eq("status", "approved")
      .is("reviewed_by", null);
    if (error) console.error(`${LOG} Could not return claim to pending.`, { claimId: input.claim.id, error: error.message });
  }
  const reason = `Automatic approval could not complete because ${why}. Claim sent to manual review.`;
  await writeClaimSystemNote(admin, {
    claimId: input.claim.id,
    note: reason,
    eventType: "auto_decision",
    eventKey: claimAutoApprovalFallbackEventKey(input.claim.id),
    metadata: { decision: "founder_review", rule: "auto_approval_fallback", technicalFallback, reason: why },
  });
  await notifyFounderReview(input, [reason], technicalFallback);
  await confirmToClaimant(input);
  return { outcome: "founder_review" };
}

/**
 * Latency measurement only (no behavior change): elapsed ms per phase,
 * logged once per claim. Contains no PII — claim id, phase names, the
 * decision/outcome, and durations.
 */
type PhaseTimer = (phase: string) => void;

export async function runClaimAutoApproval(input: ClaimFlowInput, deps: ClaimFlowDeps = {}): Promise<ClaimFlowResult> {
  const started = Date.now();
  let last = started;
  const phasesMs: Record<string, number> = {};
  const mark: PhaseTimer = (phase) => {
    const now = Date.now();
    phasesMs[phase] = now - last;
    last = now;
  };
  let outcome = "error";
  try {
    const result = await runClaimAutoApprovalTimed(input, deps, mark);
    outcome = result.outcome;
    return result;
  } finally {
    console.log(`${LOG} timing`, { claimId: input.claim.id, outcome, totalMs: Date.now() - started, phasesMs });
  }
}

async function runClaimAutoApprovalTimed(input: ClaimFlowInput, deps: ClaimFlowDeps, mark: PhaseTimer): Promise<ClaimFlowResult> {
  const admin = deps.admin ?? (createAdminClient() as unknown as SupabaseClient);
  const claimId = input.claim.id;

  await writeClaimSystemNote(admin, {
    claimId,
    note: `Claim submitted by ${input.claimant.firstName} ${input.claimant.lastName} (${input.claimant.email}, ${input.claimant.position}).`,
    eventKey: claimSubmittedEventKey(claimId),
  });
  mark("submittedNote");

  const signals = await (deps.gather ?? gatherClaimSignals)(input, { admin });
  const decision = evaluateClaimAutoApproval(signals);
  mark("gatherSignals");

  // ── Founder review ─────────────────────────────────────────────────────────
  if (decision.decision === "founder_review") {
    const heading = decision.technicalFallbackOnly
      ? "Claim held for manual review — automatic approval was unavailable (no claimant risk signal)."
      : "Claim held for manual review.";
    await writeClaimSystemNote(admin, {
      claimId,
      note: `${heading} ${decision.humanReasons.join(" ")}`,
      eventType: "auto_decision",
      eventKey: claimAutoDecisionEventKey(claimId),
      metadata: autoDecisionMetadata(decision, signals.geo),
    });
    await notifyFounderReview(input, decision.humanReasons, decision.technicalFallbackOnly);
    await confirmToClaimant(input);
    return { outcome: "founder_review" };
  }

  // ── Auto-approve ───────────────────────────────────────────────────────────
  const returningOperator = signals.existingOperator.activated;
  if (!returningOperator) {
    const plan = await planActivationVerificationMode({ email: input.claimant.email });
    if (plan !== "email_code") {
      return fallBackToFounderReview(admin, input, "email-code verification was unavailable for this account", {
        claimWasApproved: false,
        technicalFallback: true,
      });
    }
  }
  mark("planVerification");

  // Claim first: a concurrent founder decision on this claim wins cleanly.
  const { data: approvedRows, error: approveError } = await admin
    .from("venue_claims")
    .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: null })
    .eq("id", claimId)
    .eq("status", "pending")
    .select("id");
  if (approveError || (approvedRows?.length ?? 0) === 0) {
    console.warn(`${LOG} Claim was no longer pending — a founder decision took precedence.`, { claimId });
    return { outcome: "founder_review" };
  }
  mark("approveClaim");

  const provision = await provisionOperatorForVenue({
    email: input.claimant.email,
    firstName: input.claimant.firstName,
    lastName: input.claimant.lastName,
    venueId: input.venue.id,
    logTag: LOG,
    deferNewOperatorSetupEmail: !returningOperator,
    requireUnclaimedVenue: true,
    // A returning operator has nothing left to complete, so the badge is
    // earned now; a new operator earns it at activation.
    markVenueVerified: returningOperator,
    sendEmail: (link, isReturning) =>
      isReturning
        ? sendVenueAddedToAccountEmail({ to: input.claimant.email, firstName: input.claimant.firstName || "there", venueName: input.venue.name, accessLink: link })
        : sendPasswordSetupEmail({ to: input.claimant.email, firstName: input.claimant.firstName || "there", setupLink: link }),
  });
  if (!provision.ok) {
    return fallBackToFounderReview(
      admin,
      input,
      provision.ownershipConflict
        ? "the venue's ownership changed while this claim was processing (another claim or approval got there first)"
        : "the operator account could not be set up automatically",
      { claimWasApproved: true, technicalFallback: !provision.ownershipConflict }
    );
  }
  mark("provisionOperator");

  // ── Approved and owned from here on ────────────────────────────────────────
  await writeClaimSystemNote(admin, {
    claimId,
    note: autoApprovedNoteText(decision, { role: input.claimant.position, returningOperator }),
    eventType: "auto_decision",
    eventKey: claimAutoDecisionEventKey(claimId),
    metadata: autoDecisionMetadata(decision, signals.geo, { returningOperator }),
  });
  mark("decisionNote");

  const lifecycleResult = await claimOrReuseActivationLifecycle({
    operatorId: provision.authUserId,
    origin: { type: "claim", claimId },
    logTag: LOG,
    verificationRequired: provision.setupEmailDeferred === true,
  });
  let activationDeadline: string | null = null;
  if (lifecycleResult.decision === "started") {
    activationDeadline = lifecycleResult.lifecycle.deadlineAt;
    await writeActivationNote(
      {
        origin: { type: "claim", claimId },
        eventType: "activation_started",
        note: `Activation window started — set up by ${lifecycleResult.lifecycle.deadlineAt}.`,
        metadata: { activationDeadline: lifecycleResult.lifecycle.deadlineAt, flow: "claim" },
      },
      admin as unknown as Parameters<typeof writeActivationNote>[1]
    );
  } else if (lifecycleResult.decision === "reused") {
    activationDeadline = lifecycleResult.lifecycle.deadlineAt;
  }
  mark("lifecycle");

  let verificationPath: string | undefined;
  // Non-deferred provisioning only returns ok after its own setup email sent.
  let approvedSetup: ApprovedClaimSetup = "emailed";
  let nextStep: "new_operator_in_flow" | "returning_operator" | "new_operator_email" = returningOperator
    ? "returning_operator"
    : "new_operator_email";
  if (provision.setupEmailDeferred) {
    const delivery = await deliverDeferredActivationStart({
      lifecycleResult,
      delivery: "in_flow",
      origin: "claim",
      recipient: { email: input.claimant.email, firstName: input.claimant.firstName },
      requestIp: input.claim.ipAddress,
      logTag: LOG,
      sendLegacySetupEmail: (setupLink) =>
        sendPasswordSetupEmail({ to: input.claimant.email, firstName: input.claimant.firstName || "there", setupLink }),
    });
    if (delivery.kind === "code_issued") {
      verificationPath = delivery.verificationPath;
      nextStep = "new_operator_in_flow";
    } else {
      approvedSetup =
        delivery.kind === "continue_email_sent" || delivery.kind === "legacy_fallback_sent" ? "emailed" : "pending_email";
      console.warn(`${LOG} Approved claim continues by email, not in-flow.`, { claimId, delivery: delivery.kind });
    }
  }
  mark("firstCodeDelivery");

  await sendAutoApprovedClaimNotifications({
    claimId,
    venueName: input.venue.name,
    city: input.venueCity,
    claimant: { ...input.claimant, role: input.claimant.position },
    decision,
    nextStep,
    activationDeadline,
  });
  mark("founderNotifications");

  if (returningOperator) return { outcome: "auto_approved", nextPath: "/login" };
  return verificationPath ? { outcome: "auto_approved", verificationPath } : { outcome: "auto_approved", approvedSetup };
}

/**
 * Retry / double-submit: the same claimant re-submits for a venue their own
 * AUTO-APPROVED claim already owns. Instead of "not available", hand back
 * the same HHC next step — without issuing anything new. Returns null for
 * every other case (the normal "not available to claim" response applies).
 */
export async function resolveAutoApprovedClaimContinuation(
  { venueId, claimedBy, email }: { venueId: string; claimedBy: string | null; email: string },
  deps: { admin?: SupabaseClient } = {}
): Promise<{ verificationPath?: string; nextPath?: "/login" } | null> {
  if (!claimedBy) return null;
  const admin = deps.admin ?? (createAdminClient() as unknown as SupabaseClient);
  const { data: operator } = await admin.from("operators").select("id, email, account_activated_at").eq("id", claimedBy).maybeSingle();
  if (!operator || String(operator.email).toLowerCase() !== email.toLowerCase()) return null;

  const { data: claims } = await admin
    .from("venue_claims")
    .select("id")
    .eq("venue_id", venueId)
    .eq("email", email.toLowerCase())
    .eq("status", "approved");
  const claimIds = ((claims ?? []) as { id: string }[]).map((c) => c.id);
  let autoApproved = false;
  for (const id of claimIds) if (await isAutoApprovedClaim(admin, id)) autoApproved = true;
  if (!autoApproved) return null;

  if (operator.account_activated_at) return { nextPath: "/login" };
  const { data: live } = await admin
    .from("operator_activation_lifecycles")
    .select("id, verification_required")
    .eq("operator_id", operator.id as string)
    .is("expired_at", null)
    .is("released_at", null)
    .maybeSingle();
  if (!live || live.verification_required !== true) return null;
  const verificationPath = buildVerificationPath(live.id as string);
  return verificationPath ? { verificationPath } : null;
}
