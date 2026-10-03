import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { sendSlackAlert } from "@/lib/slack";
import { createSetupContactCoordinator, type SetupContactCoordinator } from "@/lib/activation/setupContactStore";
import { holdsContactClaim, runHoldingContactClaim } from "@/lib/activation/setupContactClaimGuard";

/**
 * Coordinates an AUTOMATIC initial setup email — approval/provisioning
 * (founder approval or claim auto-approval), deferred email-code start
 * (continue email / first code), and legacy tracking start — with the
 * per-operator contact claim (migration 104).
 *
 * Why these need it: a milestone for the same operator can be pending (for
 * another venue they own, or because a newly-owned venue crosses a threshold
 * soon after approval). The sendTransactionalEmail evidence hook defers any
 * LATER milestone, but without the claim a milestone already mid-send could
 * land within seconds of the setup email.
 *
 * The setup email is ONLY ever sent while holding this operator's claim. It
 * waits briefly (a normal holder releases within seconds of its provider
 * response). If the claim is still held after INITIAL_SETUP_CLAIM_WAIT_MS —
 * a slow provider, a crashed holder (its claim lives up to
 * SETUP_CONTACT_CLAIM_TTL_MS = 6 min, far beyond the 300 s function limit),
 * or the claim can't be read — the email is DEFERRED durably
 * (operators.initial_setup_deferred_at, migration 105) and the hourly
 * operator-activation worker sends it under the claim
 * (deferredInitialSetup.ts). The caller gets `onDeferred()`. Only if even
 * the deferral can't be written is nothing sent or queued: the caller's
 * failure path runs (`onUnavailable`) and #ops-critical is alerted.
 *
 * Re-entrant only within an outer initial_setup claim (provisioning →
 * deferred start). With no database credentials (local dev without
 * Supabase), or no unactivated operator for the recipient, there is nothing
 * to coordinate and the email is sent directly.
 */

/** Short enough for any request (functions are capped at 300 s); longer holds defer instead. */
export const INITIAL_SETUP_CLAIM_WAIT_MS = 10 * 1000;
const DEFAULT_POLL_MS = 500;

export type AutomaticSetupContactParams<T> = {
  operatorId?: string | null;
  /** Used to resolve the operator when no id is known (e.g. a legacy fallback without a lifecycle). */
  email?: string | null;
  /** The caller's "will be sent shortly" result: the email was queued for the worker, not sent now. */
  onDeferred: () => T;
  /** The caller's "email not sent" result: neither sent nor queued (the deferral write failed). */
  onUnavailable: (error: string) => T;
  /** Set false when the caller already alerts #ops-critical on a failed send. */
  alertOnUnavailable?: boolean;
  admin?: SupabaseClient;
  coordinator?: SetupContactCoordinator;
  now?: () => Date;
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  sendAlert?: typeof sendSlackAlert;
  logTag?: string;
};

export const INITIAL_SETUP_UNAVAILABLE_MESSAGE =
  "The setup email was not sent: it couldn't be coordinated with other emails to this operator, and it " +
  "couldn't be queued either. Use Resend setup email in the Control Panel.";

function credentialsAvailable(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function withAutomaticSetupContact<T>(params: AutomaticSetupContactParams<T>, send: () => Promise<T>): Promise<T> {
  const tag = params.logTag ?? "[setupContactAutomatic]";
  if (!params.coordinator && !params.admin && !credentialsAvailable()) return send();
  if (params.operatorId && holdsContactClaim(params.operatorId, "initial_setup")) return send();

  const now = params.now ?? (() => new Date());
  const sleep = params.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitMs = params.waitMs ?? INITIAL_SETUP_CLAIM_WAIT_MS;
  const pollMs = params.pollMs ?? DEFAULT_POLL_MS;

  // Only build an admin client when something actually needs it.
  let adminClient = params.admin ?? null;
  const admin = () => (adminClient ??= createAdminClient() as unknown as SupabaseClient);
  let coordinator = params.coordinator ?? null;

  let operatorId = params.operatorId ?? null;
  let token: string | null = null;
  let lastError: string | null = null;
  let waited = 0;
  let checkedActivation = false;
  for (;;) {
    try {
      coordinator ??= createSetupContactCoordinator(admin());
      if (!operatorId) {
        if (!params.email) return send();
        operatorId = await coordinator.findUnactivatedOperatorId(params.email);
        // No unactivated operator owns this address: nothing to coordinate.
        if (!operatorId) return send();
        if (holdsContactClaim(operatorId, "initial_setup")) return send();
        checkedActivation = true;
      }
      if (!checkedActivation) {
        // Activated (e.g. returning) operators get no coordination.
        const state = await coordinator.read(operatorId);
        if (!state || state.activated) return send();
        checkedActivation = true;
      }
      token = await coordinator.claim(operatorId, "initial_setup", now());
      if (token) break;
      lastError = null;
    } catch (err) {
      lastError = message(err);
    }
    if (waited >= waitMs) break;
    await sleep(pollMs);
    waited += pollMs;
  }

  if (!token) {
    const reason = lastError ? `contact claim failed: ${lastError}` : `contact claim still held after ${Math.round(waited / 1000)} s`;
    // Queue it for the worker rather than send beside another email.
    const deferred = operatorId && coordinator ? await coordinator.deferInitialSetup(operatorId, now()) : false;
    if (deferred) {
      console.warn(`${tag} Initial setup email deferred — ${reason}. The operator-activation worker will send it under the claim.`, { operatorId });
      return params.onDeferred();
    }
    console.error(`${tag} Initial setup email NOT sent and NOT queued — ${reason}.`, { operatorId });
    if (params.alertOnUnavailable !== false) {
      await (params.sendAlert ?? sendSlackAlert)({
        channel: "ops-critical",
        severity: "critical",
        title: "Initial setup email not sent",
        message:
          "An automatic setup email couldn't be coordinated with other emails to the same operator, and it couldn't " +
          "be queued for later delivery either. Nothing was sent. Resend the setup email from the Control Panel.",
        metadata: { "Operator ID": operatorId ?? "unresolved", Flow: tag, Reason: reason },
      });
    }
    return params.onUnavailable(INITIAL_SETUP_UNAVAILABLE_MESSAGE);
  }
  if (!operatorId || !coordinator) return params.onUnavailable(INITIAL_SETUP_UNAVAILABLE_MESSAGE); // unreachable: a token implies both

  // Evidence first, under the claim. Released only once it is safely
  // written; otherwise the claim goes stale and is folded in later as an
  // unconfirmed setup contact.
  const recorded = await coordinator.recordSetupContact(operatorId, "setup_email", now());
  try {
    return await runHoldingContactClaim(operatorId, token, send, { kind: "initial_setup" });
  } finally {
    if (recorded) await coordinator.release(operatorId, token);
  }
}
