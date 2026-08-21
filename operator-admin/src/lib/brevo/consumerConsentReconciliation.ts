import { normalizeEmail } from "./config";
import { syncConsumerBrevoEligibility } from "./consumerSync";
import { getDefaultConsumerLookupClient, type ConsumerLookupClient } from "./consumerEligibility";
import type { BrevoAdminClient } from "./supabaseAdminClient";

/**
 * Applies a genuine Brevo marketing-unsubscribe event to the matching HHC
 * consumer's marketing_consent — the inbound half of the consent loop
 * (webhookHandler.ts calls this; the outbound half is consumerSync.ts).
 *
 * Rules (Part 3 of the reconciliation task):
 *   - Supabase remains the source of truth: this only ever moves
 *     marketing_consent true -> false. Brevo is never allowed to opt a
 *     consumer back in — there is no "true" branch here at all.
 *   - Matching is by normalized (case-insensitive) email, since
 *     consumer_profiles.email is a denormalized copy written at signup
 *     time and is not guaranteed to be stored lowercased (unlike
 *     auth.users.email, which Supabase Auth normalizes internally).
 *   - No consumer is ever created, no auth.users row is ever touched, and
 *     no profile field other than marketing_consent/marketing_consent_at
 *     is ever written.
 *   - marketing_consent_at is nulled out on unsubscribe, mirroring the
 *     exact existing convention already used by updateAccountProfile()
 *     ((website)/account/actions.ts) — that field holds "when consent was
 *     granted," not a general last-changed timestamp.
 *   - Already-false is treated as a safe idempotent no-op — no redundant
 *     write, no redundant outbound enqueue.
 *   - On an actual true -> false transition, this also calls the existing
 *     outbound syncConsumerBrevoEligibility() (the same function
 *     updateAccountProfile() calls) so the same desired state is
 *     reinforced back to Brevo through the existing outbox — safe and
 *     idempotent thanks to both the outbox's own dedupe and the
 *     already-absent list-removal idempotency fix, so this can never
 *     become a runaway loop, only a single reinforcing round-trip.
 */

export type ReconcileUnsubscribeOutcome =
  | { ok: true; outcome: "updated" | "already_false" | "no_matching_consumer" }
  | { ok: false; error: string };

export async function reconcileConsumerUnsubscribe(
  email: string,
  options: {
    consumerLookupClient?: ConsumerLookupClient;
    outboxClient?: BrevoAdminClient;
  } = {}
): Promise<ReconcileUnsubscribeOutcome> {
  const normalizedEmail = normalizeEmail(email);

  // Every step below is wrapped — a thrown error (e.g. the Supabase client
  // itself failing to construct, or an unexpected client-library exception)
  // must surface as { ok: false } like a normal lookup/update error, never
  // as an uncaught throw. The caller (webhookHandler.ts) depends on this to
  // keep a genuine failure observable (event stays unprocessed) without
  // ever failing the webhook response itself.
  try {
    const client = options.consumerLookupClient ?? getDefaultConsumerLookupClient();

    const { data: profile, error: lookupError } = await client
      .from("consumer_profiles")
      .select("id, marketing_consent")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (lookupError) {
      return { ok: false, error: lookupError.message };
    }
    if (!profile) {
      // Not an HHC consumer (e.g. a founder/platform_admin identity, or an
      // address Brevo knows about that HHC never created a profile for).
      // Not an error — nothing to reconcile.
      return { ok: true, outcome: "no_matching_consumer" };
    }

    const consumerId = profile.id as string;
    const wasConsented = profile.marketing_consent === true;

    if (!wasConsented) {
      return { ok: true, outcome: "already_false" };
    }

    const { error: updateError } = await client
      .from("consumer_profiles")
      .update({ marketing_consent: false, marketing_consent_at: null })
      .eq("id", consumerId);

    if (updateError) {
      return { ok: false, error: updateError.message };
    }

    // Reinforce the same desired state outbound — never throws (see
    // consumerSync.ts's own non-blocking guarantee).
    await syncConsumerBrevoEligibility(consumerId, {
      previousMarketingConsent: true,
      lookupClient: options.consumerLookupClient,
      outboxClient: options.outboxClient,
    });

    return { ok: true, outcome: "updated" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
