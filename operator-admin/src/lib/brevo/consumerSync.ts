import { getBrevoConfig, type BrevoConfig } from "./config";
import { enqueueBrevoContactSync } from "./contactSync";
import { isEnqueueAllowedInThisEnvironment } from "./stagingGuard";
import { maskEmail } from "./maskEmail";
import {
  evaluateConsumerBrevoEligibility,
  getDefaultConsumerLookupClient,
  type ConsumerLookupClient,
} from "./consumerEligibility";
import { getDefaultBrevoAdminClient, type BrevoAdminClient } from "./supabaseAdminClient";

/**
 * Phase 2A — the single entry point every consumer lifecycle hook calls to
 * keep the Brevo outbox reflecting current HHC state. Never throws, never
 * calls the Brevo API directly (only enqueues — see contactSync.ts), and
 * never blocks the caller: a Supabase error, a missing Brevo configuration,
 * or any other failure here is logged and swallowed so it can never prevent
 * consumer signup, confirmation, or account use.
 *
 * Called from:
 *   - createConsumerProfile() (sign-up/actions.ts) — covers signup,
 *     the /auth/confirm retry, and the /auth/callback fallback, since all
 *     three already funnel through this one shared function.
 *   - updateAccountProfile() (account/actions.ts) — the post-signup
 *     marketing-consent toggle.
 *
 * Behavior:
 *   - Currently eligible (see consumerEligibility.ts) → enqueue
 *     `subscribed: true`. Safe to call unconditionally on every profile
 *     write; the outbox's own dedupe/coalesce logic (075) makes a redundant
 *     enqueue for an unchanged desired state a cheap no-op, not new work.
 *   - Not eligible, but the caller explicitly reports a same-request
 *     consent flip from true → false (`previousMarketingConsent: true`) →
 *     enqueue `subscribed: false`, so the outbox carries HHC's
 *     source-of-truth opt-out forward for whenever a later phase acts on
 *     it. This is deliberately scoped to a known, observed transition
 *     rather than inferred from current state alone — HHC has no separate
 *     "was this consumer ever previously synced to Brevo" marker, so
 *     enqueuing an unsubscribe signal for every merely-never-consented
 *     profile would be both meaningless (Brevo likely never heard of them)
 *     and noisy.
 *   - Neither of the above → no-op. No outbox row is written.
 *
 * Every enqueue below is additionally gated by
 * isEnqueueAllowedInThisEnvironment() (stagingGuard.ts) BEFORE writing to
 * the shared brevo_sync_outbox — see that function's doc comment for why
 * this exists as a distinct, earlier checkpoint from the existing
 * assertAllowedToSyncEmail() guard in client.ts, which remains untouched
 * and still runs again at actual Brevo-call time as defense in depth.
 */
export async function syncConsumerBrevoEligibility(
  consumerId: string,
  options: {
    previousMarketingConsent?: boolean;
    lookupClient?: ConsumerLookupClient;
    outboxClient?: BrevoAdminClient;
  } = {}
): Promise<void> {
  const lookupClient = options.lookupClient ?? getDefaultConsumerLookupClient();
  const outboxClient = options.outboxClient ?? getDefaultBrevoAdminClient();

  try {
    const eligibility = await evaluateConsumerBrevoEligibility(consumerId, lookupClient);

    if (eligibility.eligible) {
      const config = getBrevoConfig();
      if (!enqueueAllowedOrLog(consumerId, eligibility.email, config)) return;
      await enqueueEligible(consumerId, eligibility, config, outboxClient);
      return;
    }

    const wasPreviouslyConsented = options.previousMarketingConsent === true;
    const hasUsableEmail = eligibility.reason !== "no_profile" && eligibility.reason !== "no_usable_email";

    if (wasPreviouslyConsented && hasUsableEmail) {
      // We need the profile's email to build a meaningful desired-state
      // payload — re-read it directly rather than threading it through
      // every ineligibility branch above.
      const { data: profile } = await lookupClient
        .from("consumer_profiles")
        .select("id, email, display_name, marketing_consent")
        .eq("id", consumerId)
        .maybeSingle();

      const email = profile?.email as string | undefined;
      if (email) {
        const config = getBrevoConfig();
        if (!enqueueAllowedOrLog(consumerId, email, config)) return;
        await enqueueBrevoContactSync(
          {
            entityType: "consumer",
            entityId: consumerId,
            email,
            attributes: buildAttributes((profile?.display_name as string | null) ?? null),
            listIds: [config.consumerListId],
            subscribed: false,
          },
          outboxClient
        );
      }
      return;
    }

    // Not eligible and no relevant transition to report — nothing for
    // Brevo to know yet. No outbox row is written.
  } catch (err) {
    // Config missing (BrevoConfigError), a Supabase error, or anything
    // else — never let this reach the caller. Signup/account use must
    // never depend on Brevo being configured or reachable.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[brevo/consumerSync] sync failed (non-blocking):", message, "consumerId:", consumerId);
  }
}

/**
 * Enqueue-time staging protection check. Returns true if the caller may
 * proceed to write to brevo_sync_outbox; logs a safe (PII-masked) message
 * and returns false otherwise. Never throws.
 */
function enqueueAllowedOrLog(consumerId: string, email: string, config: BrevoConfig): boolean {
  if (isEnqueueAllowedInThisEnvironment(email, config.testEmail)) return true;

  console.warn("[brevo/consumerSync] enqueue skipped — non-production environment, email not in allowlist", {
    consumerId,
    email: maskEmail(email),
  });
  return false;
}

async function enqueueEligible(
  consumerId: string,
  eligibility: { email: string; displayName: string | null },
  config: BrevoConfig,
  outboxClient: BrevoAdminClient
): Promise<void> {
  await enqueueBrevoContactSync(
    {
      entityType: "consumer",
      entityId: consumerId,
      email: eligibility.email,
      attributes: buildAttributes(eligibility.displayName),
      listIds: [config.consumerListId],
      subscribed: true,
    },
    outboxClient
  );
}

/**
 * consumer_profiles.display_name is a single free-text field, not split
 * first/last — mirrored into Brevo's FIRSTNAME as-is, matching the existing
 * convention already used for the Resend confirmation email (the full
 * display name is passed as "firstName", never split). LASTNAME is left
 * unset rather than fabricating a split HHC doesn't have.
 */
function buildAttributes(displayName: string | null): { FIRSTNAME?: string } {
  return displayName ? { FIRSTNAME: displayName } : {};
}
