"use server";

import { createAdminClient } from "@/lib/supabase/server";

export async function createConsumerProfile({
  userId,
  email,
  displayName,
  termsAcceptedAt,
  privacyAcceptedAt,
  marketingConsent,
  marketingConsentAt,
}: {
  userId: string;
  email: string;
  displayName: string | null;
  termsAcceptedAt: string;
  privacyAcceptedAt: string;
  marketingConsent: boolean;
  marketingConsentAt: string | null;
}): Promise<string | null> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("consumer_profiles").upsert(
    {
      id: userId,
      email,
      display_name: displayName,
      terms_accepted_at: termsAcceptedAt,
      privacy_accepted_at: privacyAcceptedAt,
      marketing_consent: marketingConsent,
      marketing_consent_at: marketingConsentAt,
      last_login_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    console.error("[createConsumerProfile]", error.message, "userId:", userId);
    return error.message;
  }

  return null;
}
