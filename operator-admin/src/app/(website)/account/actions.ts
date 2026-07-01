"use server";

import { createClient } from "@/lib/supabase/server";

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

  return { success: true };
}
