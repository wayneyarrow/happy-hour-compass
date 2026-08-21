"use server";

import { createClient } from "@/lib/supabase/server";
import { syncConsumerBrevoEligibility } from "@/lib/brevo/consumerSync";
import { buildConsumerDisplayName } from "@/lib/consumerName";

export type AccountState = {
  success?: boolean;
  error?: string;
};

export async function updateAccountProfile(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const firstName = ((formData.get("first_name") as string) ?? "").trim();
  const lastName = ((formData.get("last_name") as string) ?? "").trim() || null;
  const marketingConsent = formData.get("marketing_consent") === "true";

  if (!firstName) {
    return { error: "First name is required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Read the consent value as it stands before this update — needed so
  // Brevo Phase 2A can detect a true→false opt-out transition below. A
  // failed read here just means the transition can't be detected this
  // time; it must never block the account update itself.
  const { data: previousProfile } = await supabase
    .from("consumer_profiles")
    .select("marketing_consent")
    .eq("id", user.id)
    .maybeSingle();
  const previousMarketingConsent = previousProfile?.marketing_consent === true;

  const now = new Date().toISOString();
  const displayName = buildConsumerDisplayName(firstName, lastName);

  const { error } = await supabase
    .from("consumer_profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
      display_name: displayName,
      marketing_consent: marketingConsent,
      marketing_consent_at: marketingConsent ? now : null,
      updated_at: now,
    })
    .eq("id", user.id);

  if (error) {
    console.error("[updateAccountProfile]", error.message);
    return { error: "Could not save changes. Please try again." };
  }

  // No existing Auth-metadata synchronization behavior to preserve here —
  // this action has never written to user_metadata (metadata is only ever
  // read once, as a bootstrap source, at profile-creation time). Adding a
  // new sync path is out of this task's narrow scope; consumer_profiles
  // remains the single source of truth for an existing account's name.

  // Brevo Phase 2A: re-evaluate this consumer's marketing-sync eligibility
  // after the write. Never blocks or fails this action — see
  // src/lib/brevo/consumerSync.ts.
  await syncConsumerBrevoEligibility(user.id, { previousMarketingConsent });

  return { success: true };
}
