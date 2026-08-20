import { createAdminClient } from "@/lib/supabase/server";

/**
 * Brevo marketing-sync eligibility for a single consumer.
 *
 * This is a pure read — it never enqueues, never calls Brevo, and never
 * writes anything. See consumerSync.ts for the orchestrator that acts on
 * this result.
 *
 * Eligibility rule (Phase 2A), derived entirely from HHC's existing
 * consumer data model — no new consent semantics are introduced:
 *   1. A consumer_profiles row must exist (`consumer_profiles.id`).
 *   2. The profile must have a usable email (`consumer_profiles.email`,
 *      non-empty, containing "@").
 *   3. `consumer_profiles.marketing_consent` must be true — the one and
 *      only marketing-consent field in HHC's schema (confirmed against the
 *      real `051_consumer_accounts_foundation.sql` migration; there is no
 *      other consent flag anywhere on this table or on auth.users).
 *   4. The account's email must be confirmed. HHC stores no explicit
 *      "confirmed" column anywhere (confirmed by the earlier architecture
 *      inspection) — the only source of truth is Supabase Auth's own
 *      `email_confirmed_at`, read here via `auth.admin.getUserById()`
 *      rather than a raw `auth.users` query, matching the supported admin
 *      API surface. A consumer_profiles row is created at signup, BEFORE
 *      confirmation (createConsumerProfile is called synchronously inside
 *      createConsumerAccount, prior to the user ever clicking the
 *      confirmation link) — so profile existence alone does not imply a
 *      confirmed, deliverable email. Gating Brevo eligibility on
 *      confirmation avoids syncing an address nobody has verified they
 *      actually own yet.
 */

export type ConsumerBrevoIneligibleReason =
  | "no_profile"
  | "no_usable_email"
  | "no_consent"
  | "unconfirmed_email"
  | "lookup_failed";

export type ConsumerBrevoEligibility =
  | { eligible: true; email: string; displayName: string | null }
  | { eligible: false; reason: ConsumerBrevoIneligibleReason };

/**
 * Minimal Supabase admin-client surface this module needs — narrowed so
 * tests can supply a small in-memory fake, matching the pattern already
 * established in supabaseAdminClient.ts for the outbox/webhook modules.
 */
export type ConsumerLookupClient = {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: unknown
      ): {
        maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
  };
  auth: {
    admin: {
      getUserById(id: string): Promise<{
        data: { user: { email_confirmed_at?: string | null } | null } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export function getDefaultConsumerLookupClient(): ConsumerLookupClient {
  return createAdminClient() as unknown as ConsumerLookupClient;
}

export async function evaluateConsumerBrevoEligibility(
  consumerId: string,
  client: ConsumerLookupClient = getDefaultConsumerLookupClient()
): Promise<ConsumerBrevoEligibility> {
  const { data: profile, error: profileError } = await client
    .from("consumer_profiles")
    .select("id, email, display_name, marketing_consent")
    .eq("id", consumerId)
    .maybeSingle();

  if (profileError) {
    console.error("[brevo/consumerEligibility] profile lookup failed:", profileError.message);
    return { eligible: false, reason: "lookup_failed" };
  }
  if (!profile) {
    return { eligible: false, reason: "no_profile" };
  }

  const email = profile.email as string | null;
  if (!email || !email.includes("@")) {
    return { eligible: false, reason: "no_usable_email" };
  }

  if (!profile.marketing_consent) {
    return { eligible: false, reason: "no_consent" };
  }

  const { data: userData, error: userError } = await client.auth.admin.getUserById(consumerId);
  if (userError) {
    console.error("[brevo/consumerEligibility] auth user lookup failed:", userError.message);
    return { eligible: false, reason: "lookup_failed" };
  }
  if (!userData?.user?.email_confirmed_at) {
    return { eligible: false, reason: "unconfirmed_email" };
  }

  return { eligible: true, email, displayName: (profile.display_name as string | null) ?? null };
}
