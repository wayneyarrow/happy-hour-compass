import { AsyncLocalStorage } from "node:async_hooks";
import {
  SETUP_CONTACT_SEND_START_WINDOW_MS,
  setupContactKindForEmail,
  type SetupContactClaimKind,
} from "@/lib/activation/setupContactPolicy";

/**
 * Time bounds for sends made while holding a per-operator contact claim
 * (migration 104). Every holder runs its send inside runHoldingContactClaim();
 * sendTransactionalEmail() then refuses, for setup and milestone emails, to
 * START a provider request more than SETUP_CONTACT_SEND_START_WINDOW_MS after
 * the claim was taken (nothing is sent — a definite failure). The provider
 * call itself is never cut short: a holder keeps its claim until the request
 * has resolved, because an abandoned request can still be accepted. Together
 * with that, the start window keeps SETUP_CONTACT_CLAIM_TTL_MS a safe
 * takeover point (setupContactPolicy.ts).
 *
 * Also the re-entrancy marker for withAutomaticSetupContact(): a nested
 * initial setup send for an operator whose initial_setup claim this async
 * context already holds runs inside the outer claim instead of waiting on
 * itself.
 */

type HeldContactClaim = { operatorId: string; kind: SetupContactClaimKind | null; startedAtMs: number; clock: () => number };

const held = new AsyncLocalStorage<readonly HeldContactClaim[]>();

const MILESTONE_EMAIL_TYPES = new Set(["customer_success_milestone"]);

function claimStartMs(token: string, nowMs: number): number {
  const t = Date.parse(token);
  // The token is the claim's wall-clock timestamp. Never trust one in the
  // future (or unparseable): fall back to "taken now".
  return Number.isFinite(t) && t <= nowMs ? t : nowMs;
}

/** Runs `fn` as the holder of `operatorId`'s contact claim `token`. */
export function runHoldingContactClaim<T>(
  operatorId: string,
  token: string,
  fn: () => Promise<T>,
  /**
   * `kind` marks the claim for re-entrancy (holdsContactClaim). `clock` is a
   * test seam only; production uses the real clock.
   */
  opts: { kind?: SetupContactClaimKind; clock?: () => number } = {}
): Promise<T> {
  const clock = opts.clock ?? Date.now;
  const entry: HeldContactClaim = {
    operatorId,
    kind: opts.kind ?? null,
    startedAtMs: claimStartMs(token, clock()),
    clock,
  };
  return held.run([...(held.getStore() ?? []), entry], fn);
}

/**
 * True when this async context already holds `operatorId`'s contact claim of
 * this kind. Matching the kind matters: work started from inside another
 * holder's send (e.g. a milestone) must wait for that claim, not join it.
 */
export function holdsContactClaim(operatorId: string, kind: SetupContactClaimKind): boolean {
  return (held.getStore() ?? []).some((c) => c.operatorId === operatorId && c.kind === kind);
}

export type ContactClaimSendGuard = { allowed: true } | { allowed: false; error: string };

/**
 * The send window check for an email about to be sent, or null when no contact claim
 * is held or the email isn't a setup/milestone email (other emails sent
 * from inside a claim — founder notifications, etc. — are never limited).
 */
export function contactClaimSendGuard(emailType: string): ContactClaimSendGuard | null {
  const claims = held.getStore();
  if (!claims || claims.length === 0) return null;
  if (!setupContactKindForEmail(emailType) && !MILESTONE_EMAIL_TYPES.has(emailType)) return null;
  // The oldest held claim is the binding one.
  const oldest = claims.reduce((a, b) => (b.startedAtMs < a.startedAtMs ? b : a));
  const elapsed = oldest.clock() - oldest.startedAtMs;
  if (elapsed > SETUP_CONTACT_SEND_START_WINDOW_MS) {
    return {
      allowed: false,
      error:
        `Not sent: the operator contact claim was taken ${Math.round(elapsed / 1000)} s ago, past the ` +
        `${SETUP_CONTACT_SEND_START_WINDOW_MS / 1000} s send window, so it may already have been handed to another email.`,
    };
  }
  return { allowed: true };
}
