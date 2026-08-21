import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { syncConsumerBrevoEligibility } from "@/lib/brevo/consumerSync";
import { buildConsumerDisplayName } from "@/lib/consumerName";

/**
 * Auth callback route — handles Supabase PKCE code exchange.
 *
 * Supabase redirects here after verifying an invite / recovery / magic-link
 * token. The `code` query parameter contains the PKCE exchange code.
 *
 * Expected URL shape:
 *   /auth/callback?code=<pkce_code>&next=<destination_path>
 *
 * On success: exchanges the code for a session (sets auth cookies) and
 *   redirects to `next` (defaults to /admin/home).
 * On failure: redirects to /forgot-password with ?info=link-expired so the
 *   operator reset page is shown rather than a blank page.
 *
 * Consumer signup confirmation (?next=/welcome or ?next=/account):
 *   After exchanging the code we also ensure a consumer_profiles row exists.
 *   This is a resilience measure: if profile creation failed during sign-up
 *   (e.g. transient DB error), we create it here from the user's auth metadata
 *   so the user isn't stuck in a /welcome → /sign-in redirect loop.
 *
 * The `next` parameter is validated to be a relative path only to prevent
 * open-redirect attacks.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Only allow relative paths for `next` to prevent open redirects.
  const rawNext = searchParams.get("next") ?? "/admin/home";
  const next = rawNext.startsWith("/") ? rawNext : "/admin/home";

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // For consumer signup confirmation flows (?next=/welcome or /account),
      // ensure a consumer_profiles row exists. If sign-up's createConsumerProfile
      // call succeeded this is a no-op (upsert). If it failed, this is the
      // recovery path that creates the row from stored auth metadata.
      const isConsumerFlow = (next === "/welcome" || next === "/account") && data.user;
      if (isConsumerFlow) {
        const adminClient = createAdminClient();
        const { data: existingProfile } = await adminClient
          .from("consumer_profiles")
          .select("id")
          .eq("id", data.user.id)
          .maybeSingle();

        if (!existingProfile) {
          const meta = data.user.user_metadata ?? {};
          const now = new Date().toISOString();
          // meta.display_name is a fallback for metadata written before
          // structured first_name/last_name existed — see the matching
          // comment in auth/confirm/page.tsx for the same reasoning.
          const firstName = meta.first_name ?? meta.display_name ?? null;
          const lastName = meta.last_name ?? null;
          const { error: profileError } = await adminClient
            .from("consumer_profiles")
            .insert({
              id: data.user.id,
              email: data.user.email ?? "",
              first_name: firstName,
              last_name: lastName,
              display_name: buildConsumerDisplayName(firstName, lastName),
              terms_accepted_at: meta.consumer_terms_accepted_at ?? now,
              privacy_accepted_at: meta.consumer_privacy_accepted_at ?? now,
              marketing_consent: meta.consumer_marketing_consent ?? false,
              marketing_consent_at: meta.consumer_marketing_consent_at ?? null,
              last_login_at: now,
            });

          if (profileError) {
            console.error("[auth/callback] consumer_profiles fallback insert failed:", profileError.message);
          }
        }

        // Brevo Phase 2A: this is the third (rare) path that can create/
        // touch a consumer_profiles row — see createConsumerProfile's own
        // call site (sign-up/actions.ts) for the primary two. Safe to call
        // whether the insert above ran or the profile already existed.
        // Never blocks this redirect — see consumerSync.ts.
        await syncConsumerBrevoEligibility(data.user.id);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error("[auth/callback] Code exchange failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/forgot-password?info=link-expired`);
}
