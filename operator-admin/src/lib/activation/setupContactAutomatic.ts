import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { createSetupContactCoordinator, type SetupContactCoordinator } from "@/lib/activation/setupContactStore";

/**
 * Coordinates an AUTOMATIC initial setup email — approval/provisioning
 * (founder approval or claim auto-approval), deferred email-code activation
 * start (continue email / first code), and legacy tracking start — with the
 * per-operator contact claim (migration 104).
 *
 * Why these need it: a milestone for the same operator can be pending (for
 * another venue they own, or because a newly-owned venue crosses a threshold
 * soon after approval). The sendTransactionalEmail evidence hook defers any
 * LATER milestone, but without the claim a milestone already mid-send could
 * land within seconds of the setup email.
 *
 * Unlike founder resends, an initial setup email must never be refused (the
 * claimant is waiting for it), so this waits briefly for the claim — a
 * milestone send takes seconds — and records evidence under it. If the claim
 * is STILL busy after the bounded wait, it logs an explicit warning, records
 * the evidence anyway, and sends: delaying the setup email is worse than a
 * rare near-simultaneous milestone, and the race is never silent.
 *
 * Re-entrant: a nested call for the same operator in the same async context
 * (provisioning → deferred start) runs directly instead of waiting on its
 * own claim. Never throws on coordination failures; the send's own result
 * and errors are returned unchanged.
 */

const DEFAULT_WAIT_MS = 8000;
const DEFAULT_POLL_MS = 500;

const heldClaims = new AsyncLocalStorage<ReadonlySet<string>>();

export type AutomaticSetupContactParams = {
  operatorId?: string | null;
  /** Used to resolve the operator when no id is known (e.g. a legacy fallback without a lifecycle). */
  email?: string | null;
  admin?: SupabaseClient;
  coordinator?: SetupContactCoordinator;
  now?: () => Date;
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logTag?: string;
};

function credentialsAvailable(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export async function withAutomaticSetupContact<T>(params: AutomaticSetupContactParams, send: () => Promise<T>): Promise<T> {
  const tag = params.logTag ?? "[setupContactAutomatic]";
  if (!params.coordinator && !params.admin && !credentialsAvailable()) return send();

  let operatorId = params.operatorId ?? null;
  let coordinator: SetupContactCoordinator;
  try {
    // Only build an admin client when something actually needs it.
    let adminClient = params.admin ?? null;
    const admin = () => (adminClient ??= createAdminClient() as unknown as SupabaseClient);
    coordinator = params.coordinator ?? createSetupContactCoordinator(admin());
    if (!operatorId && params.email) {
      const { data } = await admin()
        .from("operators")
        .select("id, account_activated_at")
        .eq("email", params.email.trim().toLowerCase())
        .maybeSingle();
      if (data && !(data as { account_activated_at: string | null }).account_activated_at) operatorId = (data as { id: string }).id;
    }
  } catch (err) {
    console.warn(`${tag} Setup-contact coordination unavailable; sending without it.`, { error: err instanceof Error ? err.message : String(err) });
    return send();
  }
  if (!operatorId) return send();
  if (heldClaims.getStore()?.has(operatorId)) return send();

  const now = params.now ?? (() => new Date());
  const sleep = params.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitMs = params.waitMs ?? DEFAULT_WAIT_MS;
  const pollMs = params.pollMs ?? DEFAULT_POLL_MS;

  let token: string | null = null;
  let waited = 0;
  try {
    for (;;) {
      token = await coordinator.claim(operatorId, "initial_setup", now());
      if (token || waited >= waitMs) break;
      await sleep(pollMs);
      waited += pollMs;
    }
  } catch (err) {
    console.warn(`${tag} Contact claim failed; sending without it.`, { operatorId, error: err instanceof Error ? err.message : String(err) });
    token = null;
  }

  if (!token) {
    console.warn(`${tag} Another automated email to this operator was still in flight after ${waited} ms — sending the setup email anyway (it must not be delayed further).`, { operatorId });
    await coordinator.recordSetupContact(operatorId, "setup_email", now());
    return send();
  }

  const recorded = await coordinator.recordSetupContact(operatorId, "setup_email", now());
  const held = new Set(heldClaims.getStore() ?? []);
  held.add(operatorId);
  try {
    return await heldClaims.run(held, send);
  } finally {
    // Released only once evidence is safely written; otherwise the stale
    // claim is folded in later as an unconfirmed setup contact.
    if (recorded) await coordinator.release(operatorId, token);
  }
}
