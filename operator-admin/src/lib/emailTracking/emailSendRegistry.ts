import { isEmailOpenTrackingEnabled } from "./emailTrackingConfig";
import {
  classifyOpenNotification,
  computeSendRef,
  resolveEmailEnvironment,
  sanitizeSendContext,
  sanitizeTrackingError,
  type EmailEnvironment,
  type EmailSendContext,
} from "./emailTrackingPolicy";
import { createSupabaseEmailTrackingStore, isStoreError, type EmailTrackingStore, type EmailMessageRow } from "./emailTrackingStore";

/**
 * The email send registry — called ONLY from sendTransactionalEmail()
 * (src/lib/email.ts), which every HHC transactional email already goes
 * through. Callers never call this directly; they describe the send by
 * passing `record` to sendTransactionalEmail (or to the email.ts helper
 * that wraps it).
 *
 * Sequence per send:
 *   1. registerEmailSend() — BEFORE the provider call. Inserts (or, for a
 *      retry of the same idempotency key, reuses) the email_messages row
 *      keyed by send_key / send_ref. Registering first is what lets an open
 *      that arrives before step 3 still match (via the hhc_send_ref tag).
 *   2. Resend send (email.ts + trackedSend.ts). The request never depends
 *      on this row — tags are derived from the send key alone.
 *   3. recordEmailSendResult() — stores the provider message id, outcome,
 *      and the domain the accepted request was actually sent FROM (an open
 *      can only ever be reported when that is the tracked subdomain).
 *
 * TRACKING MUST NEVER BLOCK OR FAIL AN EMAIL. Every step here:
 *   - catches its own errors (a failed/throwing store ⇒ the email is sent
 *     without a registry row — the request itself never depends on it);
 *   - is bounded by REGISTRY_TIMEOUT_MS, so a slow or hung database cannot
 *     delay a critical setup/verification email past that bound (the
 *     database client has no request timeout of its own). A registration
 *     that loses the race is abandoned: the email goes out exactly as
 *     planned, just without a row to match its opens to; the late insert,
 *     if it lands, leaves an inert 'pending' row.
 */

export const REGISTRY_TIMEOUT_MS = 2_000;

export type EmailRecordContext = {
  venueId?: string | null;
  operatorId?: string | null;
  lifecycleId?: string | null;
  customerSuccessEventId?: string | null;
  claimId?: string | null;
  submissionId?: string | null;
  context?: EmailSendContext;
};

export type RegisteredEmailSend = {
  emailMessageId: string;
  attemptNumber: number;
};

export type EmailRegistryDeps = {
  store?: EmailTrackingStore;
  isEnabled?: () => boolean;
  environment?: EmailEnvironment;
  now?: () => Date;
  timeoutMs?: number;
};

function resolveStore(deps: EmailRegistryDeps): EmailTrackingStore {
  return deps.store ?? createSupabaseEmailTrackingStore();
}

/** Resolves to `fallback` if `work` hasn't settled within `ms`. `work` must never reject. */
async function withTimeout<T>(work: Promise<T>, ms: number, fallback: T, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      onTimeout();
      resolve(fallback);
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function registerEmailSend(
  input: { type: string; to: string; sendKey: string; record?: EmailRecordContext },
  deps: EmailRegistryDeps = {}
): Promise<RegisteredEmailSend | null> {
  if (!(deps.isEnabled ?? isEmailOpenTrackingEnabled)()) return null;
  return withTimeout(registerUnbounded(input, deps), deps.timeoutMs ?? REGISTRY_TIMEOUT_MS, null, () =>
    console.error("[emailTracking] Registration timed out — sending without a registry record (opens for this email cannot be matched).", { type: input.type })
  );
}

async function registerUnbounded(
  input: { type: string; to: string; sendKey: string; record?: EmailRecordContext },
  deps: EmailRegistryDeps
): Promise<RegisteredEmailSend | null> {
  try {
    const store = resolveStore(deps);
    const environment = deps.environment ?? resolveEmailEnvironment();
    const sendKey = input.sendKey;
    const record = input.record ?? {};

    let venueId = record.venueId ?? null;
    let operatorId = record.operatorId ?? null;
    let claimId = record.claimId ?? null;
    let submissionId = record.submissionId ?? null;

    // A lifecycle fully determines its operator and origin; fill whatever
    // the caller didn't already know (e.g. verification codes, reminders).
    if (record.lifecycleId && (!venueId || !operatorId || (!claimId && !submissionId))) {
      const links = await store.resolveLifecycleLinks(record.lifecycleId);
      if (links) {
        venueId ??= links.venueId;
        operatorId ??= links.operatorId;
        if (!claimId && !submissionId) {
          claimId = links.claimId;
          submissionId = links.submissionId;
        }
      }
    }
    // A claim/submission knows its venue (once it has one).
    if (!venueId && (claimId || submissionId)) {
      venueId = await store.resolveOriginVenue({ claimId, submissionId });
    }

    const openNotification = classifyOpenNotification(input.type, record.context);
    const inserted = await store.insertEmailMessage({
      send_key: sendKey,
      send_ref: computeSendRef(sendKey),
      email_type: input.type,
      open_notification: openNotification,
      recipient_email: input.to.trim().toLowerCase(),
      environment,
      venue_id: venueId,
      operator_id: operatorId,
      lifecycle_id: record.lifecycleId ?? null,
      customer_success_event_id: record.customerSuccessEventId ?? null,
      claim_id: claimId,
      submission_id: submissionId,
      send_context: sanitizeSendContext(record.context),
    });

    let row: EmailMessageRow | null = null;
    if ("row" in inserted) row = inserted.row;
    else if ("conflict" in inserted) row = await store.findEmailMessageBySendKey(sendKey); // retry of the same logical send
    else console.error("[emailTracking] Registration insert failed — sending without a registry record (opens for this email cannot be matched).", { type: input.type, error: inserted.error });

    if (!row) return null;
    return { emailMessageId: row.id, attemptNumber: row.attempt_count + 1 };
  } catch (err) {
    console.error("[emailTracking] Registration threw — sending without a registry record (opens for this email cannot be matched).", {
      type: input.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function recordEmailSendResult(
  registered: RegisteredEmailSend | null,
  result: { ok: boolean; id?: string; error?: string; sentFromDomain?: string | null },
  deps: EmailRegistryDeps = {}
): Promise<void> {
  if (!registered) return;
  await withTimeout(recordUnbounded(registered, result, deps), deps.timeoutMs ?? REGISTRY_TIMEOUT_MS, undefined, () =>
    console.error("[emailTracking] Recording send result timed out.", { emailMessageId: registered.emailMessageId })
  );
}

async function recordUnbounded(
  registered: RegisteredEmailSend,
  result: { ok: boolean; id?: string; error?: string; sentFromDomain?: string | null },
  deps: EmailRegistryDeps
): Promise<void> {
  try {
    const store = resolveStore(deps);
    const at = (deps.now ?? (() => new Date()))().toISOString();
    const outcome = result.ok
      ? await store.markEmailSent(registered.emailMessageId, {
          providerMessageId: result.id ?? null,
          sentFromDomain: result.sentFromDomain ?? null,
          at,
          attemptCount: registered.attemptNumber,
        })
      : await store.markEmailFailed(registered.emailMessageId, {
          error: sanitizeTrackingError(result.error),
          at,
          attemptCount: registered.attemptNumber,
        });
    if (isStoreError(outcome)) {
      console.error("[emailTracking] Recording send result failed.", { emailMessageId: registered.emailMessageId, error: outcome.error });
    }
  } catch (err) {
    console.error("[emailTracking] Recording send result threw.", {
      emailMessageId: registered.emailMessageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
