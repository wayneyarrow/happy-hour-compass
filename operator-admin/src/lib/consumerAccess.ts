import { createClient } from "@/lib/supabase/server";

/**
 * Returns whether a `consumer_profiles` row exists for the given auth user
 * ID — the app's existing signal for "this identity has Consumer access"
 * (already used inline by (website)/layout.tsx, (website)/account/page.tsx,
 * and middleware.ts). Extracted here so the same check can be reused by the
 * Consumer Login wrong-context check and the recovery-context resolution in
 * src/lib/postAuthAccess.ts.
 *
 * Uses the request-scoped session client, not the admin client — RLS already
 * permits a signed-in user to read their own consumer_profiles row (the
 * existing call sites above rely on the same thing), and self-scoping this
 * way means the caller can never accidentally check a different user's row.
 *
 * Server-only. Never import from a Client Component.
 */
export async function hasConsumerProfile(userId: string): Promise<boolean> {
  if (!userId) return false;

  const supabase = await createClient();
  const { data } = await supabase
    .from("consumer_profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  return !!data;
}
