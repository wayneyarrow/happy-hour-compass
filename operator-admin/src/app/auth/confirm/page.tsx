"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { createConsumerProfile } from "@/app/(consumer-auth)/sign-up/actions";
import { trackGA4Event } from "@/lib/ga4";

/**
 * /auth/confirm
 *
 * Establishes a consumer session from a Supabase signup-confirmation link.
 *
 * Session flow (hash-fragment / implicit) — this is the consumer-side
 * counterpart to /operator/create-password's own documented handling of
 * admin-generated Supabase links: supabase.auth.admin.generateLink()
 * (used by createConsumerAccount(), src/app/(consumer-auth)/sign-up/actions.ts)
 * is called server-side with no browser session/code_verifier to anchor a
 * PKCE exchange, so it can only ever produce the older implicit/hash-fragment
 * link style (#access_token=...&refresh_token=...&type=signup) — never the
 * ?code=... query-param style /auth/callback (a separate, unrelated route,
 * intentionally left untouched) expects. Pointing the consumer confirmation
 * link at /auth/callback sent every real confirmation click straight into
 * that route's "no code present" fallback — the operator password-reset
 * page — without ever establishing a session.
 *
 *   1. Consumer clicks "Confirm my email →" in the signup confirmation email.
 *   2. Supabase's /auth/v1/verify verifies the signup token.
 *   3. Supabase redirects here with tokens in the URL hash:
 *        /auth/confirm?next=/welcome#access_token=...&refresh_token=...&type=signup
 *   4. On mount, this page parses the hash and calls setSession() directly.
 *   5. On success, retries createConsumerProfile() (sign-up/actions.ts) from
 *      the confirmed user's auth metadata — a resilience measure for the case
 *      where profile creation failed transiently during sign-up, mirroring
 *      the equivalent fallback /auth/callback performs for the PKCE flow.
 *      createConsumerProfile upserts on id, so this is a no-op if the row
 *      already exists.
 *   6. Redirects (client-side) to `next` (defaults to /welcome).
 *   7. On failure — no hash tokens and no existing session — shows a
 *      consumer-appropriate expired-link message, rather than the unrelated
 *      operator /forgot-password page.
 */
export default function AuthConfirmPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  // Latches once consumer_email_confirmed has fired so this effect can never
  // report it twice for the same mount (e.g. React StrictMode's dev-only
  // double-invoke). The hash-token branch below only runs at all on the
  // one-time click-through from the confirmation email — a reload or
  // revisit after tokens are stripped from the URL (see history.replaceState
  // below) falls through to the pre-existing-session fallback path instead,
  // which never reaches this ref.
  const confirmedTrackedRef = useRef(false);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const rawNext = new URLSearchParams(window.location.search).get("next") ?? "/welcome";
      const next = rawNext.startsWith("/") ? rawNext : "/welcome";

      // --- Path A: explicit hash-fragment signup token handling ---
      // Supabase signup confirmation links redirect with tokens in the URL
      // hash. Parse and call setSession() explicitly — do not rely on the
      // browser client auto-detecting hash tokens, which is unreliable in
      // this context (same rationale as /operator/create-password).
      const hash = window.location.hash.slice(1); // strip leading "#"
      if (hash) {
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const type = params.get("type");

        if (type === "signup" && accessToken && refreshToken) {
          const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          // Remove tokens from the address bar so they are not reprocessed
          // on refresh and are not visible in browser history.
          window.history.replaceState(null, "", window.location.pathname + window.location.search);

          if (!sessionError) {
            // Fire only here: a real Supabase signup-token verification just
            // succeeded and setSession() just established an authenticated
            // consumer session. Never fires from Path B below (pre-existing
            // session / revisited or already-consumed link) or from ordinary
            // /welcome visits.
            if (!confirmedTrackedRef.current) {
              confirmedTrackedRef.current = true;
              trackGA4Event("consumer_email_confirmed");
            }

            // Resilience measure mirroring /auth/callback's fallback for the
            // PKCE flow: createConsumerAccount's own createConsumerProfile
            // call (sign-up/actions.ts) may have failed transiently. Retry it
            // here from the confirmed user's auth metadata — createConsumerProfile
            // upserts on id, so this is a no-op if the row already exists.
            const user = sessionData.user;
            if (user) {
              const meta = user.user_metadata ?? {};
              const nowIso = new Date().toISOString();
              const profileError = await createConsumerProfile({
                userId: user.id,
                email: user.email ?? "",
                displayName: meta.display_name ?? null,
                termsAcceptedAt: meta.consumer_terms_accepted_at ?? nowIso,
                privacyAcceptedAt: meta.consumer_privacy_accepted_at ?? nowIso,
                marketingConsent: meta.consumer_marketing_consent ?? false,
                marketingConsentAt: meta.consumer_marketing_consent_at ?? null,
              });
              if (profileError) {
                console.error("[auth/confirm] createConsumerProfile retry failed:", profileError);
              }
            }

            router.replace(next);
            router.refresh();
            return;
          }
        }
      }

      // --- Path B: fallback for a pre-existing session ---
      // Handles the "page revisited after tokens were already consumed" case.
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        router.replace(next);
        router.refresh();
        return;
      }

      setSessionChecked(true);
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <p className="text-sm text-gray-400">Confirming your account…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Link unavailable</h1>
        <p className="text-sm text-gray-500 mb-6">
          This confirmation link has expired or has already been used.
        </p>
        <Link
          href="/sign-in"
          className="text-sm text-amber-600 hover:text-amber-700 font-medium"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
