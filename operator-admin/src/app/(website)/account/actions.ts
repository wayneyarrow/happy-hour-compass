"use server";

import { createClient } from "@/lib/supabase/server";
import { syncConsumerBrevoEligibility } from "@/lib/brevo/consumerSync";

export type AccountState = {
  success?: boolean;
  error?: string;
};

export async function updateAccountProfile(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const displayName = ((formData.get("display_name") as string) ?? "").trim() || null;
  const marketingConsent = formData.get("marketing_consent") === "true";

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

  const { error } = await supabase
    .from("consumer_profiles")
    .update({
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

  // Brevo Phase 2A: re-evaluate this consumer's marketing-sync eligibility
  // after the write. Never blocks or fails this action — see
  // src/lib/brevo/consumerSync.ts.
  await syncConsumerBrevoEligibility(user.id, { previousMarketingConsent });

  return { success: true };
}
