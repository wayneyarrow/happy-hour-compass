import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSlackAlert } from "@/lib/slack";
import { sendPasswordSetupEmail, sendOperatorActivationEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/siteUrl";
import { generateLinkWithRetry } from "@/lib/supabase/generateLinkWithRetry";
import { buildVerificationContinueUrl } from "@/lib/activation/emailCodeVerificationService";
import { sendContinueSetupEmail } from "@/lib/activation/emailCodeVerificationEmails";
import { writeActivationNote } from "@/lib/activation/activationNotes";
import type { ActivationEventType } from "@/lib/activation/activationEvents";
import { createSetupContactCoordinator, type SetupContactCoordinator } from "@/lib/activation/setupContactStore";
import { runHoldingContactClaim } from "@/lib/activation/setupContactClaimGuard";

/**
 * Delivers initial setup emails that were QUEUED because another email to
 * the same operator held the setup-contact claim (setupContactAutomatic.ts,
 * migration 105). Runs as the last step of the hourly operator-activation
 * worker (processActivationReminders.ts), live passes only.
 *
 * Each queued operator is handled under the operator's contact claim
 * (initial_setup), exactly like an immediate initial send — never beside
 * another email; a busy claim leaves it for the next pass. The email is the
 * one the operator's live lifecycle needs now (continue-setup for an
 * email-code lifecycle, otherwise the legacy setup email with a fresh
 * recovery link and its origin's template).
 *
 * DECISIONS USE CONFIRMED EVIDENCE ONLY. A queued request is "no longer
 * needed" only when last_setup_email_accepted_at — the START time of a setup
 * email the provider ACCEPTED — is at or after the request. The pre-send
 * last_setup_contact_at (migration 104) is never used here: it is written
 * before every attempt, including ones that then fail or are unconfirmed.
 *
 * DUPLICATE PROTECTION:
 *   - The attempt is marked (initial_setup_deferred_attempt_started_at)
 *     before sending. A marker still present on a later pass means that
 *     attempt was interrupted (60 s cron deadline, crash). If acceptance
 *     evidence covers the request, it's done; if the interrupted attempt was
 *     for the current request and nothing confirms it, delivery is
 *     UNCONFIRMED — recorded and alerted, never resent blindly.
 *   - An uncertain provider outcome is never retried. Definite rejections are
 *     retried on later passes, up to MAX_ATTEMPTS, then alerted.
 *   - The entry is cleared by compare-and-swap on the exact request time the
 *     worker acted on: a NEWER request that arrived meanwhile survives and is
 *     sent on a later pass (the email already sent started before it, so its
 *     acceptance evidence doesn't answer it).
 *   - New sends start only before `stopStartingAtMs`, so a pass doesn't start
 *     one it can't finish inside the cron's 60 s limit.
 */

export const DEFERRED_INITIAL_SETUP_BATCH = 25;
export const DEFERRED_INITIAL_SETUP_MAX_ATTEMPTS = 3;
/** Within a 60 s cron invocation, new queued sends start only in the first 30 s. */
export const DEFERRED_INITIAL_SETUP_START_BUDGET_MS = 30 * 1000;

export type QueuedInitialSetup = {
  operatorId: string;
  email: string;
  firstName: string | null;
  queuedAt: string;
};

/** The queue entry and confirmed-delivery evidence, read fresh under the claim. */
export type QueuedInitialSetupState = {
  activated: boolean;
  queuedAt: string | null;
  attemptStartedAt: string | null;
  attempts: number;
  /** Start time of the latest setup email the provider ACCEPTED (migration 105). */
  acceptedAt: string | null;
};

export type QueuedSetupLifecycle = {
  id: string;
  originType: "claim" | "submission";
  originClaimId: string | null;
  originSubmissionId: string | null;
  verificationRequired: boolean;
};

export type DeferredInitialSetupStore = {
  /** Unactivated operators with a queued initial setup email, oldest first. */
  listQueued(limit: number): Promise<QueuedInitialSetup[]>;
  /** Clears queue entries of operators who activated in the meantime. */
  clearActivated(): Promise<number>;
  readState(operatorId: string): Promise<QueuedInitialSetupState | null>;
  /** The operator's live (unexpired, unreleased) lifecycle, if any. */
  findLiveLifecycle(operatorId: string): Promise<QueuedSetupLifecycle | null>;
  /** Marks an attempt for exactly `queuedAt` (CAS: still that request, no attempt marked). */
  markAttempt(operatorId: string, queuedAt: string, at: string): Promise<boolean>;
  /** Clears an attempt marker only if it is still exactly `attemptAt`. */
  clearAttempt(operatorId: string, attemptAt: string): Promise<boolean>;
  /** Clears the whole entry only if the request is still exactly `queuedAt`. */
  clear(operatorId: string, queuedAt: string): Promise<boolean>;
  /** Records a definite rejection for exactly `queuedAt` and clears its attempt marker. */
  recordFailure(operatorId: string, queuedAt: string, attempts: number, error: string): Promise<boolean>;
};

export type SendQueuedSetupEmail = (p: {
  lifecycle: QueuedSetupLifecycle;
  to: string;
  firstName: string;
}) => Promise<{ ok: boolean; error?: string; deliveryUncertain?: boolean }>;

export type DeferredInitialSetupDeps = {
  store?: DeferredInitialSetupStore;
  coordinator?: SetupContactCoordinator;
  sendEmail?: SendQueuedSetupEmail;
  writeNote?: typeof writeActivationNote;
  sendAlert?: typeof sendSlackAlert;
  /** Wall clock (attempt markers must be comparable with request and acceptance times). */
  clock?: () => Date;
  /** Start no new send at or after this instant (epoch ms). */
  stopStartingAtMs?: number;
};

export type DeferredInitialSetupResult = {
  sent: number;
  cleared: number;
  busy: number;
  unconfirmed: number;
  failed: number;
  /** Entries left for the next pass because this pass's start budget ran out. */
  leftForNextPass: number;
  errors: string[];
};

const LOG = "[deferredInitialSetup]";
const ms = (t: string) => new Date(t).getTime();

export async function processDeferredInitialSetupEmails(
  admin: SupabaseClient,
  now: Date,
  deps: DeferredInitialSetupDeps = {}
): Promise<DeferredInitialSetupResult> {
  const result: DeferredInitialSetupResult = { sent: 0, cleared: 0, busy: 0, unconfirmed: 0, failed: 0, leftForNextPass: 0, errors: [] };
  const store = deps.store ?? createDeferredInitialSetupStore(admin);
  const coordinator = deps.coordinator ?? createSetupContactCoordinator(admin);
  const sendEmail = deps.sendEmail ?? createQueuedSetupEmailSender(admin);
  const writeNote = deps.writeNote ?? writeActivationNote;
  const sendAlert = deps.sendAlert ?? sendSlackAlert;
  const clock = deps.clock ?? (() => new Date());

  try {
    result.cleared += await store.clearActivated();
  } catch (err) {
    result.errors.push(`clearActivated: ${message(err)}`);
  }

  let queued: QueuedInitialSetup[];
  try {
    queued = await store.listQueued(DEFERRED_INITIAL_SETUP_BATCH);
  } catch (err) {
    result.errors.push(`listQueued: ${message(err)}`);
    return result;
  }

  for (let i = 0; i < queued.length; i++) {
    if (deps.stopStartingAtMs !== undefined && clock().getTime() >= deps.stopStartingAtMs) {
      result.leftForNextPass += queued.length - i;
      break;
    }
    try {
      await processOne(queued[i]);
    } catch (err) {
      result.errors.push(`${queued[i].operatorId}: ${message(err)}`);
    }
  }
  return result;

  async function processOne(item: QueuedInitialSetup): Promise<void> {
    const token = await coordinator.claim(item.operatorId, "initial_setup", now);
    if (!token) {
      result.busy++; // another email to this operator is (or may still be) in flight
      return;
    }
    let release = true;
    try {
      const q = await store.readState(item.operatorId);
      if (!q?.queuedAt) return; // already handled
      if (q.activated) {
        if (await store.clear(item.operatorId, q.queuedAt)) result.cleared++;
        return;
      }
      const confirmedSince = (t: string) => q.acceptedAt !== null && ms(q.acceptedAt) >= ms(t);

      if (q.attemptStartedAt) {
        // A previous pass was interrupted mid-send (60 s cron deadline, crash).
        if (confirmedSince(q.queuedAt)) {
          await store.clear(item.operatorId, q.queuedAt);
          result.cleared++;
          if (confirmedSince(q.attemptStartedAt)) {
            await note(item, "queued_setup_email_sent", `Queued setup email to ${item.email} — delivery confirmed by the email provider after the sending pass was interrupted. Not sent again.`);
          }
          return;
        }
        if (ms(q.attemptStartedAt) >= ms(q.queuedAt)) {
          // That attempt was for THIS request and nothing confirms it: it may
          // or may not have been accepted. Never resend blindly.
          await store.clear(item.operatorId, q.queuedAt);
          result.unconfirmed++;
          await note(item, "queued_setup_email_unconfirmed", `Queued setup email to ${item.email} — the sending pass was interrupted and the provider never confirmed delivery, so it may or may not have arrived. Not sent again automatically.`);
          await sendAlert({
            channel: "ops-critical",
            severity: "critical",
            title: "Queued setup email — delivery unconfirmed",
            message: "A queued setup email's send was interrupted and delivery is unconfirmed. It won't be sent again automatically. Check the Resend log, then resend from the Control Panel if needed.",
            metadata: { "Operator ID": item.operatorId, Recipient: item.email, "Queued at": q.queuedAt, "Attempt started": q.attemptStartedAt },
          });
          return;
        }
        // The interrupted attempt answered an OLDER request; a newer one is
        // queued and still needs its own email.
        await store.clearAttempt(item.operatorId, q.attemptStartedAt);
      } else if (confirmedSince(q.queuedAt)) {
        // A setup email the provider accepted started after this request.
        if (await store.clear(item.operatorId, q.queuedAt)) result.cleared++;
        return;
      }

      const lifecycle = await store.findLiveLifecycle(item.operatorId);
      if (!lifecycle) {
        if (await store.clear(item.operatorId, q.queuedAt)) result.cleared++;
        await sendAlert({
          channel: "ops-critical",
          severity: "critical",
          title: "Queued setup email not sent — no live activation window",
          message:
            "A setup email was queued for an operator who has not set up their account, but they have no live " +
            "activation window to send it for. Nothing was sent. Check the operator's Claim/Submission and resend.",
          metadata: { "Operator ID": item.operatorId, Recipient: item.email, "Queued at": q.queuedAt },
        });
        return;
      }

      // Mark the attempt (never earlier than the request it answers).
      const attemptAt = new Date(Math.max(clock().getTime(), ms(q.queuedAt))).toISOString();
      if (!(await store.markAttempt(item.operatorId, q.queuedAt, attemptAt))) return; // changed under us — next pass

      // Evidence first, under the claim (released only once it's written).
      release = await coordinator.recordSetupContact(item.operatorId, "setup_email", now);
      const sent = await runHoldingContactClaim(
        item.operatorId,
        token,
        () => sendEmail({ lifecycle, to: item.email, firstName: item.firstName?.trim() || "there" }),
        { kind: "initial_setup" }
      );
      // Clears this request; a newer one that arrived meanwhile keeps its entry (only our marker is cleared).
      const finish = async () => {
        if (!(await store.clear(item.operatorId, q.queuedAt!))) await store.clearAttempt(item.operatorId, attemptAt);
      };

      if (sent.ok) {
        await finish();
        result.sent++;
        await note(item, "queued_setup_email_sent", `Setup email sent to ${item.email} — it was queued at ${q.queuedAt} because another email to this operator was being sent.`, lifecycle);
        return;
      }
      if (sent.deliveryUncertain !== false) {
        await finish();
        result.unconfirmed++;
        await note(item, "queued_setup_email_unconfirmed", `Queued setup email to ${item.email} — the email provider's response was unclear, so delivery is unconfirmed. Not retried automatically.`, lifecycle);
        await sendAlert({
          channel: "ops-critical",
          severity: "critical",
          title: "Queued setup email — delivery unconfirmed",
          message: "The provider may or may not have accepted a queued setup email. It won't be retried automatically. Check the Resend log, then resend from the Control Panel if needed.",
          metadata: { "Operator ID": item.operatorId, "Lifecycle ID": lifecycle.id, Recipient: item.email, Error: sent.error ?? "unknown" },
        });
        return;
      }
      const attempts = q.attempts + 1;
      result.failed++;
      if (attempts >= DEFERRED_INITIAL_SETUP_MAX_ATTEMPTS) {
        await finish();
        await sendAlert({
          channel: "ops-critical",
          severity: "critical",
          title: "Queued setup email failed",
          message: `A queued setup email was rejected ${attempts} times and won't be retried. Nothing was sent. Resend it from the Control Panel.`,
          metadata: { "Operator ID": item.operatorId, "Lifecycle ID": lifecycle.id, Recipient: item.email, Error: sent.error ?? "unknown" },
        });
      } else if (!(await store.recordFailure(item.operatorId, q.queuedAt, attempts, sent.error ?? "unknown"))) {
        await store.clearAttempt(item.operatorId, attemptAt);
      }
    } finally {
      if (release) await coordinator.release(item.operatorId, token);
    }
  }

  async function note(item: QueuedInitialSetup, eventType: ActivationEventType, text: string, known?: QueuedSetupLifecycle) {
    const lifecycle = known ?? (await store.findLiveLifecycle(item.operatorId).catch(() => null));
    if (!lifecycle) return;
    const origin =
      lifecycle.originType === "claim"
        ? ({ type: "claim", claimId: lifecycle.originClaimId! } as const)
        : ({ type: "submission", submissionId: lifecycle.originSubmissionId! } as const);
    const res = await writeNote({
      origin,
      eventType,
      note: text,
      metadata: { lifecycleId: lifecycle.id, recipient: item.email, sentAt: clock().toISOString() },
      eventKey: `hhc-queued-setup:${item.operatorId}:${item.queuedAt}:${eventType}`,
    });
    if (!res.ok) console.error(`${LOG} Note failed.`, { lifecycleId: lifecycle.id, error: res.error });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Production implementations ───────────────────────────────────────────────

const RESET = {
  initial_setup_deferred_at: null,
  initial_setup_deferred_attempt_started_at: null,
  initial_setup_deferred_attempts: 0,
  initial_setup_deferred_last_error: null,
};

export function createDeferredInitialSetupStore(admin: SupabaseClient): DeferredInitialSetupStore {
  const matched = (data: unknown) => (Array.isArray(data) ? data.length > 0 : !!data);
  return {
    async listQueued(limit) {
      const { data, error } = await admin
        .from("operators")
        .select("id, email, first_name, initial_setup_deferred_at")
        .not("initial_setup_deferred_at", "is", null)
        .is("account_activated_at", null)
        .order("initial_setup_deferred_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        operatorId: r.id as string,
        email: r.email as string,
        firstName: (r.first_name as string | null) ?? null,
        queuedAt: r.initial_setup_deferred_at as string,
      }));
    },
    async clearActivated() {
      const { data, error } = await admin
        .from("operators")
        .update(RESET)
        .not("initial_setup_deferred_at", "is", null)
        .not("account_activated_at", "is", null)
        .select("id");
      if (error) throw new Error(error.message);
      return data?.length ?? 0;
    },
    async readState(operatorId) {
      const { data, error } = await admin
        .from("operators")
        .select("account_activated_at, initial_setup_deferred_at, initial_setup_deferred_attempt_started_at, initial_setup_deferred_attempts, last_setup_email_accepted_at")
        .eq("id", operatorId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        activated: !!data.account_activated_at,
        queuedAt: (data.initial_setup_deferred_at as string | null) ?? null,
        attemptStartedAt: (data.initial_setup_deferred_attempt_started_at as string | null) ?? null,
        attempts: (data.initial_setup_deferred_attempts as number | null) ?? 0,
        acceptedAt: (data.last_setup_email_accepted_at as string | null) ?? null,
      };
    },
    async findLiveLifecycle(operatorId) {
      const { data, error } = await admin
        .from("operator_activation_lifecycles")
        .select("id, origin_type, origin_claim_id, origin_submission_id, verification_required")
        .eq("operator_id", operatorId)
        .is("expired_at", null)
        .is("released_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id as string,
        originType: data.origin_type as "claim" | "submission",
        originClaimId: (data.origin_claim_id as string | null) ?? null,
        originSubmissionId: (data.origin_submission_id as string | null) ?? null,
        verificationRequired: !!data.verification_required,
      };
    },
    async markAttempt(operatorId, queuedAt, at) {
      const { data, error } = await admin
        .from("operators")
        .update({ initial_setup_deferred_attempt_started_at: at })
        .eq("id", operatorId)
        .eq("initial_setup_deferred_at", queuedAt)
        .is("initial_setup_deferred_attempt_started_at", null)
        .select("id");
      if (error) throw new Error(error.message);
      return matched(data);
    },
    async clearAttempt(operatorId, attemptAt) {
      const { data, error } = await admin
        .from("operators")
        .update({ initial_setup_deferred_attempt_started_at: null })
        .eq("id", operatorId)
        .eq("initial_setup_deferred_attempt_started_at", attemptAt)
        .select("id");
      if (error) throw new Error(error.message);
      return matched(data);
    },
    async clear(operatorId, queuedAt) {
      const { data, error } = await admin.from("operators").update(RESET).eq("id", operatorId).eq("initial_setup_deferred_at", queuedAt).select("id");
      if (error) throw new Error(error.message);
      return matched(data);
    },
    async recordFailure(operatorId, queuedAt, attempts, error) {
      const { data, error: updateError } = await admin
        .from("operators")
        .update({
          initial_setup_deferred_attempt_started_at: null,
          initial_setup_deferred_attempts: attempts,
          initial_setup_deferred_last_error: error.slice(0, 500),
        })
        .eq("id", operatorId)
        .eq("initial_setup_deferred_at", queuedAt)
        .select("id");
      if (updateError) throw new Error(updateError.message);
      return matched(data);
    },
  };
}

/**
 * The email an immediate initial send would have produced, for the
 * lifecycle as it is now: the continue-setup email (email-code lifecycle),
 * or the legacy setup email with a fresh recovery link.
 */
export function createQueuedSetupEmailSender(admin: SupabaseClient): SendQueuedSetupEmail {
  return async ({ lifecycle, to, firstName }) => {
    const record = {
      lifecycleId: lifecycle.id,
      claimId: lifecycle.originClaimId,
      submissionId: lifecycle.originSubmissionId,
    };
    if (lifecycle.verificationRequired) {
      const continueUrl = buildVerificationContinueUrl(lifecycle.id);
      if (!continueUrl) return { ok: false, error: "Email-code verification link unavailable (HMAC secret not configured).", deliveryUncertain: false };
      return sendContinueSetupEmail({ to, firstName, origin: lifecycle.originType, continueUrl, record: { ...record, context: { trigger: "continue_setup" } } });
    }
    const { data, error } = await generateLinkWithRetry(admin, {
      type: "recovery",
      email: to,
      options: { redirectTo: `${getSiteUrl()}/operator/create-password` },
    });
    if (error || !data?.properties?.action_link) {
      return { ok: false, error: `Setup link could not be generated: ${error?.message ?? "no link"}`, deliveryUncertain: false };
    }
    const send = lifecycle.originType === "claim" ? sendPasswordSetupEmail : sendOperatorActivationEmail;
    return send({ to, firstName, setupLink: data.properties.action_link, record });
  };
}
