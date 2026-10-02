import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { sendSlackAlert } from "@/lib/slack";
import { getSiteUrl } from "@/lib/siteUrl";
import { generateLinkWithRetry } from "@/lib/supabase/generateLinkWithRetry";
import { buildTokenHashRecoveryLink } from "@/lib/supabase/recoveryLink";
import { sendFinalSetupEmail } from "@/lib/activation/finalSetupEmail";
import {
  SETUP_LINK_LOCK_MS,
  GENERATE_LINK_TIMEOUT_MS,
  FINAL_SEND_TIMEOUT_MS,
  isSetupLinkClaimActive,
  isReminderLeaseActive,
} from "@/lib/activation/setupLinkLock";

/**
 * Founder post-expiry personal follow-up (migration 103): "Final resend
 * setup email" and "Copy setup link", available from a Claim/Submission
 * detail page once the setup window has ended (deadline passed — whether or
 * not the expiry worker has stamped expired_at yet) without account setup.
 *
 * Deliberately kept OUT of the "use server" file — like every other
 * founder-only activation action, finalSetupFollowUpActions.ts is a thin,
 * fixed-signature wrapper and this module's DI seam is unreachable from the
 * network.
 *
 * WHAT THESE ACTIONS NEVER DO: reopen the lifecycle, clear/set expired_at,
 * move deadline_at, touch any reminder_* column, or change venue ownership
 * or verification. The only lifecycle write is the short-lived
 * setup_link_claimed_at lock. Automatic reminders stay stopped (the worker
 * never sends a reminder once deadline_at has passed — selectCatchUpStage()),
 * and Extend remains a separate, explicit action.
 *
 * ONE SETUP ROUTE FOR EVERY FLOW. Both legacy and email-code lifecycles get
 * the same inbox-verified link: a Supabase recovery link in the scanner-safe
 * token_hash shape, pointing at /operator/create-password?…&intent=setup.
 *   - Legacy: identical to the pre-existing recovery path.
 *   - Email-code: once the window has closed, the code screen is closed too
 *     (every verification SQL function returns lifecycle_closed when
 *     deadline_at <= now — migration 100), so a /operator/verify link would
 *     be a dead end. resolvePasswordRecoveryGate() allows recovery once the
 *     window has closed, so completeOperatorAccountActivation() accepts
 *     setup completed through this link. Receiving the link at the
 *     operator's own inbox is the email verification. Live email-code
 *     windows are untouched: these actions refuse to run before the deadline.
 *
 * LINK LIFETIME: a Supabase recovery link expires mailer_otp_exp seconds
 * after it is generated — 86400 (24 h) in this project's Auth config
 * (verified via the Management API on 2026-10-02; one Supabase project
 * backs every environment). Generating a new recovery link replaces the
 * operator's previous one, so an earlier setup email's link stops working.
 * setup_link_claimed_at (a CAS lock) stops two concurrent founder requests
 * from generating two links and invalidating each other's.
 *
 * Never logs, stores, notes or Slacks the link or its token.
 */

export const SETUP_LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;
export { SETUP_LINK_LOCK_MS };

const LOCK_BUSY_MESSAGE =
  "Another setup email or link was just requested for this operator, or an earlier request is still finishing. Wait a few minutes, then refresh and try again.";
const GENERATE_TIMEOUT_MESSAGE =
  "Supabase didn't respond in time, so nothing was sent. A setup link may still be issued in the background (which would replace earlier links). Wait a few minutes before trying again.";
const REMINDER_IN_FLIGHT_MESSAGE =
  "An automatic reminder is being processed for this operator right now. Wait a minute, then refresh and try again.";
const LOCK_LOST_MESSAGE =
  "This request took too long and another setup request may have replaced its link, so nothing was sent. Refresh and try again.";

export type FinalFollowUpOrigin = { type: "claim"; claimId: string } | { type: "submission"; submissionId: string };

export type FinalSetupEmailState = {
  success?: true;
  successAction?: string;
  /** Shown alongside a success when something non-essential (the timeline note) failed. */
  warning?: string;
  error?: string;
};

export type FinalSetupLinkResult =
  | { ok: true; link: string; expiresAt: string; recipient: string; warning?: string }
  | { ok: false; error: string };

type AdminClient = SupabaseClient;

export type FinalSetupFollowUpDeps = {
  authClient?: Awaited<ReturnType<typeof createClient>>;
  adminClient?: AdminClient;
  checkAdmin?: (email: string | undefined) => Promise<boolean>;
  generateLink?: typeof generateLinkWithRetry;
  sendEmail?: typeof sendFinalSetupEmail;
  sendAlert?: typeof sendSlackAlert;
  revalidate?: (path: string) => void;
  now?: () => Date;
  siteUrl?: string;
  /** Test-only overrides for the in-process waits (setupLinkLock.ts). */
  timeoutsMs?: { generateLink?: number; send?: number };
};

type Bounded<T> = { timedOut: false; value: T } | { timedOut: true };

/**
 * Stops WAITING after `ms`. The underlying call is not cancelled (neither
 * Supabase's nor Resend's client accepts an abort signal here) — which is
 * why a timeout keeps the setup-link claim instead of releasing it: the
 * call may still complete in the background (see SETUP_LINK_LOCK_MS).
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<Bounded<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  try {
    return await Promise.race([promise.then((value) => ({ timedOut: false as const, value })), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type FollowUpContext = {
  lifecycleId: string;
  operatorId: string;
  email: string;
  firstName: string | null;
  venueId: string;
  venueName: string;
  origin: FinalFollowUpOrigin;
  deadlineAt: string;
  expiredAt: string | null;
  verificationRequired: boolean;
  setupLinkClaimedAt: string | null;
  reminderLeaseStartedAt: string | null;
};

function originNoun(origin: FinalFollowUpOrigin): string {
  return origin.type === "claim" ? "claim" : "submission";
}

function originId(origin: FinalFollowUpOrigin): string {
  return origin.type === "claim" ? origin.claimId : origin.submissionId;
}

/**
 * Fresh, authoritative eligibility — never trusts the rendered page.
 * Eligible only when: a lifecycle is tracked for THIS origin, it isn't
 * released, its setup window has ended, the operator is still unactivated,
 * and the operator still owns the venue this origin points at.
 */
async function resolveFollowUpContext(
  admin: AdminClient,
  origin: FinalFollowUpOrigin,
  now: Date
): Promise<{ ok: true; ctx: FollowUpContext } | { ok: false; error: string }> {
  const noun = originNoun(origin);
  const { data: lifecycle, error: lifecycleError } = await admin
    .from("operator_activation_lifecycles")
    .select("id, operator_id, deadline_at, expired_at, released_at, verification_required, setup_link_claimed_at, reminder_lease_started_at")
    .eq(origin.type === "claim" ? "origin_claim_id" : "origin_submission_id", originId(origin))
    .maybeSingle();
  if (lifecycleError) {
    console.error("[finalSetupFollowUp] Lifecycle lookup failed:", lifecycleError.message);
    return { ok: false, error: "Could not load this activation. Please try again." };
  }
  if (!lifecycle) {
    return { ok: false, error: `No activation is tracked for this ${noun}, so there is no setup window to follow up on.` };
  }
  if (lifecycle.released_at) {
    return { ok: false, error: "This venue has been released. Final follow-up is no longer available." };
  }
  const deadlineAt = lifecycle.deadline_at as string;
  if (!lifecycle.expired_at && new Date(deadlineAt).getTime() > now.getTime()) {
    return { ok: false, error: "The setup window is still open — use Resend setup email instead." };
  }

  const { data: operator, error: operatorError } = await admin
    .from("operators")
    .select("email, first_name, account_activated_at")
    .eq("id", lifecycle.operator_id as string)
    .maybeSingle();
  if (operatorError) {
    console.error("[finalSetupFollowUp] Operator lookup failed:", operatorError.message);
    return { ok: false, error: "Could not verify the operator's account. Please try again." };
  }
  if (!operator?.email) return { ok: false, error: "No operator account was found for this activation." };
  if (operator.account_activated_at) {
    return { ok: false, error: "This operator has already finished account setup. No setup email or link is needed." };
  }

  const originTable = origin.type === "claim" ? "venue_claims" : "operator_submissions";
  const { data: originRow, error: originError } = await admin
    .from(originTable)
    .select("venue_id")
    .eq("id", originId(origin))
    .maybeSingle();
  if (originError) {
    console.error("[finalSetupFollowUp] Origin lookup failed:", originError.message);
    return { ok: false, error: `Could not load this ${noun}. Please try again.` };
  }
  const venueId = (originRow?.venue_id as string | null) ?? null;
  if (!venueId) return { ok: false, error: `This ${noun} is not linked to a venue.` };

  const { data: venue, error: venueError } = await admin
    .from("venues")
    .select("id, name, created_by_operator_id")
    .eq("id", venueId)
    .maybeSingle();
  if (venueError) {
    console.error("[finalSetupFollowUp] Venue lookup failed:", venueError.message);
    return { ok: false, error: "Could not load the venue. Please try again." };
  }
  if (!venue) return { ok: false, error: "The venue for this activation could not be found." };
  if (venue.created_by_operator_id !== lifecycle.operator_id) {
    return { ok: false, error: "This operator no longer owns this venue, so a setup email or link would not give them access to it." };
  }

  return {
    ok: true,
    ctx: {
      lifecycleId: lifecycle.id as string,
      operatorId: lifecycle.operator_id as string,
      email: operator.email as string,
      firstName: (operator.first_name as string | null) ?? null,
      venueId,
      venueName: (venue.name as string | null) ?? "your venue",
      origin,
      deadlineAt,
      expiredAt: (lifecycle.expired_at as string | null) ?? null,
      verificationRequired: lifecycle.verification_required === true,
      setupLinkClaimedAt: (lifecycle.setup_link_claimed_at as string | null) ?? null,
      reminderLeaseStartedAt: (lifecycle.reminder_lease_started_at as string | null) ?? null,
    },
  };
}

/** Compare-and-swap on the previously read lock value — the lock is only taken if nobody changed it since. */
async function claimSetupLinkLock(admin: AdminClient, ctx: FollowUpContext, now: Date): Promise<string | null> {
  if (isSetupLinkClaimActive(ctx.setupLinkClaimedAt, now)) {
    return null;
  }
  const claimedAt = now.toISOString();
  const base = admin
    .from("operator_activation_lifecycles")
    .update({ setup_link_claimed_at: claimedAt })
    .eq("id", ctx.lifecycleId)
    .is("released_at", null);
  const cas = ctx.setupLinkClaimedAt ? base.eq("setup_link_claimed_at", ctx.setupLinkClaimedAt) : base.is("setup_link_claimed_at", null);
  const { data, error } = await cas.select("id, setup_link_claimed_at").maybeSingle();
  if (error) {
    console.error("[finalSetupFollowUp] Setup-link lock claim failed:", error.message);
    return null;
  }
  if (!data) return null;
  // Our ownership token is the value the database stored, as it returns it
  // (PostgREST formats timestamptz as "…+00:00", not the "…Z" we wrote).
  return (data.setup_link_claimed_at as string | null) ?? claimedAt;
}

/**
 * Same instant, regardless of how each side was formatted ("…Z" vs
 * "…+00:00", trailing zeros). Never compare timestamptz values as strings.
 */
function isSameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && ta === tb;
}

/**
 * Whether this request still holds its own claim. Re-checked after link
 * generation, immediately before the link is emailed or returned: if the
 * request outlived SETUP_LINK_LOCK_MS and another request took over, that
 * request's newer link replaces ours, so ours must not be sent.
 */
async function stillHoldsSetupLinkLock(admin: AdminClient, lifecycleId: string, claimedAt: string): Promise<boolean> {
  const { data, error } = await admin
    .from("operator_activation_lifecycles")
    .select("setup_link_claimed_at")
    .eq("id", lifecycleId)
    .maybeSingle();
  if (error) {
    console.error("[finalSetupFollowUp] Setup-link lock re-check failed:", error.message);
    return false;
  }
  const holds = isSameInstant(data?.setup_link_claimed_at as string | null | undefined, claimedAt);
  if (!holds) {
    // Diagnostic only — never the link or token.
    console.warn("[finalSetupFollowUp] Setup-link claim no longer ours.", {
      lifecycleId,
      ourClaim: claimedAt,
      currentClaim: (data?.setup_link_claimed_at as string | null | undefined) ?? null,
    });
  }
  return holds;
}

async function releaseSetupLinkLock(admin: AdminClient, lifecycleId: string, claimedAt: string): Promise<void> {
  // Only clears our own claim; a failure here self-heals after SETUP_LINK_LOCK_MS.
  await admin
    .from("operator_activation_lifecycles")
    .update({ setup_link_claimed_at: null })
    .eq("id", lifecycleId)
    .eq("setup_link_claimed_at", claimedAt);
}

type Prepared =
  | { ok: true; ctx: FollowUpContext; user: { id: string; email: string | null }; link: string; expiresAt: string; claimedAt: string }
  | { ok: false; error: string };

/**
 * Shared path for both actions: authorize → resolve → lock → re-resolve
 * under the lock (closes the race with Release/activation) → generate one
 * fresh token_hash setup link. On any failure after the lock, the lock is
 * released before returning.
 */
async function prepareSetupLink(
  origin: FinalFollowUpOrigin,
  admin: AdminClient,
  deps: FinalSetupFollowUpDeps
): Promise<Prepared> {
  const authClient = deps.authClient ?? (await createClient());
  const { data: { user } } = await authClient.auth.getUser();
  const checkAdmin = deps.checkAdmin ?? isControlPanelAdmin;
  if (!user || !(await checkAdmin(user.email))) return { ok: false, error: "Unauthorized." };

  const now = (deps.now ?? (() => new Date()))();
  const first = await resolveFollowUpContext(admin, origin, now);
  if (!first.ok) return first;
  if (isReminderLeaseActive(first.ctx.reminderLeaseStartedAt, now)) return { ok: false, error: REMINDER_IN_FLIGHT_MESSAGE };

  const claimedAt = await claimSetupLinkLock(admin, first.ctx, now);
  if (!claimedAt) return { ok: false, error: LOCK_BUSY_MESSAGE };

  const fresh = await resolveFollowUpContext(admin, origin, now);
  if (!fresh.ok || fresh.ctx.lifecycleId !== first.ctx.lifecycleId) {
    await releaseSetupLinkLock(admin, first.ctx.lifecycleId, claimedAt);
    return fresh.ok ? { ok: false, error: "This activation changed just now. Please refresh and try again." } : fresh;
  }
  const ctx = fresh.ctx;
  // Checked AFTER taking our own claim — the reminder worker does the
  // mirror-image check after taking its lease (setupLinkLock.ts), so a
  // reminder that slipped in at the deadline can't replace our link.
  if (isReminderLeaseActive(ctx.reminderLeaseStartedAt, now)) {
    await releaseSetupLinkLock(admin, ctx.lifecycleId, claimedAt);
    return { ok: false, error: REMINDER_IN_FLIGHT_MESSAGE };
  }

  const redirectTo = `${deps.siteUrl ?? getSiteUrl()}/operator/create-password`;
  const generated = await withTimeout(
    (deps.generateLink ?? generateLinkWithRetry)(admin, {
      type: "recovery",
      email: ctx.email,
      options: { redirectTo },
    }),
    deps.timeoutsMs?.generateLink ?? GENERATE_LINK_TIMEOUT_MS
  );
  if (generated.timedOut) {
    // Keep our claim: the request may still complete and issue a link.
    console.error("[finalSetupFollowUp] generateLink timed out; claim kept until it expires.", { lifecycleId: ctx.lifecycleId });
    return { ok: false, error: GENERATE_TIMEOUT_MESSAGE };
  }
  const { data: linkData, error: linkError } = generated.value;
  const hashedToken = linkData?.properties?.hashed_token;
  if (linkError || !hashedToken) {
    console.error("[finalSetupFollowUp] generateLink failed:", linkError?.message ?? "no hashed_token returned");
    await releaseSetupLinkLock(admin, ctx.lifecycleId, claimedAt);
    return { ok: false, error: "A setup link could not be generated. Nothing was sent — please try again." };
  }

  if (!(await stillHoldsSetupLinkLock(admin, ctx.lifecycleId, claimedAt))) {
    // Not ours any more — never release someone else's claim.
    return { ok: false, error: LOCK_LOST_MESSAGE };
  }

  return {
    ok: true,
    ctx,
    user: { id: user.id, email: user.email ?? null },
    // token_hash shape (never action_link): the page waits for an explicit
    // "Continue" click, so scanners/previews can't consume it.
    link: `${buildTokenHashRecoveryLink(redirectTo, hashedToken)}&intent=setup`,
    expiresAt: new Date(now.getTime() + SETUP_LINK_LIFETIME_MS).toISOString(),
    claimedAt,
  };
}

async function writeOriginNote(
  admin: AdminClient,
  origin: FinalFollowUpOrigin,
  payload: { note: string; event_type: string; metadata_json: Record<string, unknown>; created_by: string; created_by_email: string | null }
): Promise<{ ok: boolean; error?: string }> {
  const { error } =
    origin.type === "claim"
      ? await admin.from("venue_claim_notes").insert({ claim_id: origin.claimId, ...payload })
      : await admin.from("operator_submission_notes").insert({ submission_id: origin.submissionId, ...payload });
  return error ? { ok: false, error: error.message } : { ok: true };
}

function revalidateOrigin(origin: FinalFollowUpOrigin, venueId: string, revalidate: (path: string) => void): void {
  if (origin.type === "claim") revalidate(`/control-panel/claims/${origin.claimId}`);
  else revalidate(`/control-panel/operator-submissions/${origin.submissionId}`);
  revalidate(`/control-panel/venues/${venueId}`);
}

/**
 * Shared note metadata. Deliberately excludes the recipient: the email note
 * adds `recipient` (rendered "Sent to"), while the copied-link note uses
 * `operatorEmail` so the timeline never claims a copied link was sent.
 */
function baseMetadata(ctx: FollowUpContext, expiresAt: string): Record<string, unknown> {
  return {
    lifecycleId: ctx.lifecycleId,
    venueId: ctx.venueId,
    linkExpiresAt: expiresAt,
    deadline: ctx.deadlineAt,
    flow: ctx.origin.type,
    setupFlow: ctx.verificationRequired ? "email_code" : "legacy",
  };
}

// ── Final resend setup email ────────────────────────────────────────────────

export async function sendFinalSetupEmailImpl(
  origin: FinalFollowUpOrigin,
  deps: FinalSetupFollowUpDeps = {}
): Promise<FinalSetupEmailState> {
  const admin = deps.adminClient ?? createAdminClient();
  const prepared = await prepareSetupLink(origin, admin, deps);
  if (!prepared.ok) return { error: prepared.error };
  const { ctx, user, link, expiresAt, claimedAt } = prepared;
  // Released in `finally` unless the provider call is still unresolved.
  let keepClaim = false;

  try {
    const sendPromise = (deps.sendEmail ?? sendFinalSetupEmail)({
      to: ctx.email,
      firstName: ctx.firstName,
      venueName: ctx.venueName,
      setupLink: link,
      record: {
        venueId: ctx.venueId,
        operatorId: ctx.operatorId,
        lifecycleId: ctx.lifecycleId,
        claimId: origin.type === "claim" ? origin.claimId : null,
        submissionId: origin.type === "submission" ? origin.submissionId : null,
        context: { trigger: "final_follow_up" },
      },
    });
    const bounded = await withTimeout(sendPromise, deps.timeoutsMs?.send ?? FINAL_SEND_TIMEOUT_MS);

    if (bounded.timedOut) {
      // Ambiguous: the provider may still accept (or already have accepted)
      // this email. Keep the claim so no competing request can replace its
      // link while it might still be delivered, and record exactly that —
      // never "sent", never an automatic retry.
      keepClaim = true;
      console.error("[finalSetupFollowUp] Provider did not respond in time; delivery unknown, claim kept.", { lifecycleId: ctx.lifecycleId });
      await writeOriginNote(admin, origin, {
        note:
          `Final setup email to ${ctx.email} attempted by founder — the email provider did not respond in time, so delivery is ` +
          `unconfirmed. Automatic reminders remain stopped; the setup window was not extended.`,
        event_type: "final_setup_email_unconfirmed",
        metadata_json: { ...baseMetadata(ctx, expiresAt), operatorEmail: ctx.email },
        created_by: user.id,
        created_by_email: user.email,
      });
      revalidateOrigin(origin, ctx.venueId, deps.revalidate ?? revalidatePath);
      return {
        error:
          `The email provider didn't respond in time, so we can't tell whether the email to ${ctx.email} was sent. ` +
          `If it arrives, its link works. Wait a few minutes before resending or copying a link — doing so would replace it.`,
      };
    }
    const sendResult = bounded.value;

    if (!sendResult.ok) {
      console.error("[finalSetupFollowUp] Final setup email send failed:", { lifecycleId: ctx.lifecycleId, error: sendResult.error });
      return {
        error:
          `The email to ${ctx.email} may not have been sent (${sendResult.error ?? "unknown error"}). A new setup link was ` +
          `generated, so any earlier setup link no longer works — try again, or use Copy setup link.`,
      };
    }

    // Backstop: the claim should still be ours (the waits above are far
    // shorter than SETUP_LINK_LOCK_MS). If a later request did take over,
    // its newer link replaced the one in this email — say so.
    const supersededDuringSend = !(await stillHoldsSetupLinkLock(admin, ctx.lifecycleId, claimedAt));

    const sentAt = (deps.now ?? (() => new Date()))().toISOString();
    const note = await writeOriginNote(admin, origin, {
      note: `Final setup email sent to ${ctx.email} by founder. Automatic reminders remain stopped; the setup window was not extended.`,
      event_type: "final_setup_email_sent",
      metadata_json: { ...baseMetadata(ctx, expiresAt), recipient: ctx.email, sentAt, ...(supersededDuringSend ? { supersededDuringSend: true } : {}) },
      created_by: user.id,
      created_by_email: user.email,
    });

    revalidateOrigin(origin, ctx.venueId, deps.revalidate ?? revalidatePath);

    if (!note.ok) {
      console.error("[finalSetupFollowUp] Note failed after the final setup email was accepted:", { lifecycleId: ctx.lifecycleId, error: note.error });
      await (deps.sendAlert ?? sendSlackAlert)({
        channel: "ops-alerts",
        severity: "warning",
        title: "Final setup email sent, but its Internal Note failed to write",
        message: "The email was accepted by the provider; only the timeline entry is missing. Do not resend just to fix the note.",
        metadata: { "Lifecycle ID": ctx.lifecycleId, Origin: `${ctx.origin.type} ${originId(origin)}`, Error: note.error ?? "unknown" },
      });
      return {
        success: true,
        successAction: `Final setup email sent to ${ctx.email}`,
        warning: "The timeline entry could not be saved. The email was sent — no need to resend.",
      };
    }

    if (supersededDuringSend) {
      return {
        success: true,
        successAction: `Final setup email sent to ${ctx.email}`,
        warning: "A newer setup link was generated while this email was sending, so the link in this email no longer works. The newer link is the one to use.",
      };
    }

    return { success: true, successAction: `Final setup email sent to ${ctx.email}` };
  } finally {
    // Never clears a newer request's claim (CAS on our own claimedAt).
    if (!keepClaim) await releaseSetupLinkLock(admin, ctx.lifecycleId, claimedAt);
  }
}

// ── Copy setup link ─────────────────────────────────────────────────────────

export async function generateFinalSetupLinkImpl(
  origin: FinalFollowUpOrigin,
  deps: FinalSetupFollowUpDeps = {}
): Promise<FinalSetupLinkResult> {
  const admin = deps.adminClient ?? createAdminClient();
  const prepared = await prepareSetupLink(origin, admin, deps);
  if (!prepared.ok) return { ok: false, error: prepared.error };
  const { ctx, user, link, expiresAt, claimedAt } = prepared;

  try {
    const generatedAt = (deps.now ?? (() => new Date()))().toISOString();
    // Records only that a link was generated for manual sharing — never the
    // link itself, and never a claim that it was sent or received.
    const note = await writeOriginNote(admin, origin, {
      note:
        `Final setup link generated by founder for ${ctx.email}, to share manually. Not emailed by Happy Hour Compass. ` +
        `Automatic reminders remain stopped; the setup window was not extended.`,
      event_type: "final_setup_link_generated",
      metadata_json: { ...baseMetadata(ctx, expiresAt), operatorEmail: ctx.email, generatedAt },
      created_by: user.id,
      created_by_email: user.email,
    });

    revalidateOrigin(origin, ctx.venueId, deps.revalidate ?? revalidatePath);

    if (!note.ok) {
      console.error("[finalSetupFollowUp] Note failed after a setup link was generated:", { lifecycleId: ctx.lifecycleId, error: note.error });
      await (deps.sendAlert ?? sendSlackAlert)({
        channel: "ops-alerts",
        severity: "warning",
        title: "Final setup link generated, but its Internal Note failed to write",
        message: "A setup link was generated for manual sharing; only the timeline entry is missing.",
        metadata: { "Lifecycle ID": ctx.lifecycleId, Origin: `${ctx.origin.type} ${originId(origin)}`, Error: note.error ?? "unknown" },
      });
      return { ok: true, link, expiresAt, recipient: ctx.email, warning: "The timeline entry could not be saved." };
    }

    return { ok: true, link, expiresAt, recipient: ctx.email };
  } finally {
    await releaseSetupLinkLock(admin, ctx.lifecycleId, claimedAt);
  }
}
