"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import PasswordInput from "@/components/PasswordInput";
import { completeAccountSetupAction } from "./actions";

// "checking":  initial load, determining which recovery path (if any) applies.
// "confirm":   a token_hash link was opened — waiting on the user's explicit
//   action before calling verifyOtp() (see handleContinue below for why).
// "verifying": the user has clicked Continue; the one-time verifyOtp() call
//   is in flight.
// "form":      a session is established (via verifyOtp() or the legacy
//   hash-fragment path) — show the password form.
// "unavailable": no usable session — link expired, already used, or invalid.
type Phase = "checking" | "confirm" | "verifying" | "form" | "unavailable";

/**
 * /operator/create-password
 *
 * Password setup/reset page for operators, reached from two different
 * emails that both redirect here:
 *   1. Claim-approval onboarding ("Set up my password") — provisionOperatorForVenue
 *      (src/lib/operatorActivation.ts), still sends Supabase's raw action_link.
 *   2. Operator forgot-password ("Reset your password") — forgotPasswordAction
 *      (src/app/forgot-password/actions.ts), sends a token_hash link.
 *
 * Session flow — two supported shapes, mirroring the Consumer recovery page
 * ((consumer-auth)/account/reset-password/page.tsx):
 *
 *   Path A — token_hash query param (current forgot-password emails):
 *     /operator/create-password?token_hash=...&type=recovery
 *     Loading this page must NOT call verifyOtp() automatically — Supabase
 *     documents email-security scanners prefetching links as a common cause
 *     of single-use recovery tokens being silently consumed before the user
 *     ever opens the message (confirmed directly in the Casa de Frida
 *     operator-login investigation). Capture the token and wait for an
 *     explicit "Continue" click (handleContinue) instead.
 *
 *   Path B — hash-fragment tokens (legacy — still what the claim-approval
 *     onboarding email produces, since that flow is unchanged by this task):
 *     /operator/create-password#access_token=...&refresh_token=...&type=recovery
 *     Supabase's own /auth/v1/verify already consumed the token server-side
 *     to produce this redirect, so there's nothing left to defer — call
 *     setSession() on mount as before.
 *
 *   Path C — pre-existing cookie session (e.g. page refresh after either
 *     exchange above already completed).
 *
 * On submit: supabase.auth.updateUser({ password }), then redirect into the
 * Business/Operator experience (/admin/home) — this is the "Business
 * recovery → Business context" half of the Consumer/Business recovery
 * model; see (consumer-auth)/account/reset-password/page.tsx for the
 * Consumer half.
 */
export default function CreatePasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [phase, setPhase] = useState<Phase>("checking");
  const [pendingTokenHash, setPendingTokenHash] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // In-memory guard against a double click/Enter firing verifyOtp() twice —
  // recovery tokens are single-use, so a second call would always fail.
  // Checked synchronously, so it closes the gap before the disabled-button
  // re-render takes effect. Mirrors the Consumer recovery page's same guard.
  const verifyingRef = useRef(false);

  useEffect(() => {
    async function init() {
      // --- Path A: token_hash query param ---
      const searchParams = new URLSearchParams(window.location.search);
      const tokenHash = searchParams.get("token_hash");
      const otpType = searchParams.get("type");

      if (tokenHash && otpType === "recovery") {
        setPendingTokenHash(tokenHash);
        setPhase("confirm");
        return;
      }

      // --- Path B: legacy hash-fragment recovery token ---
      const hash = window.location.hash.slice(1); // strip leading "#"
      if (hash) {
        const params = new URLSearchParams(hash);
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const type = params.get("type");

        if (type === "recovery" && accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          // Remove tokens from the address bar so they are not reprocessed
          // on refresh and are not visible in browser history.
          window.history.replaceState(null, "", window.location.pathname);

          setPhase(sessionError ? "unavailable" : "form");
          return;
        }
      }

      // --- Path C: pre-existing cookie session ---
      const { data: { session } } = await supabase.auth.getSession();
      setPhase(session ? "form" : "unavailable");
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleContinue(e: { preventDefault(): void }) {
    e.preventDefault();

    if (verifyingRef.current || !pendingTokenHash) return;
    verifyingRef.current = true;
    setPhase("verifying");

    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: pendingTokenHash,
      type: "recovery",
    });

    // Remove the token from the address bar now that it's been used.
    window.history.replaceState(null, "", window.location.pathname);

    setPhase(verifyError ? "unavailable" : "form");
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setDone(true);

    // Fires the shared one-time "operator account activated" internal
    // notification (no-ops on password resets — see completeAccountSetupAction).
    // Awaited so the request isn't aborted by the navigation below, but its
    // outcome must never block the operator from reaching their dashboard.
    //
    // The access token is read explicitly from this same browser client's
    // in-memory session and passed to the server action, which asks Supabase
    // Auth to verify it — rather than having the server action derive
    // identity from the cookie-based session on its own. The cookie write
    // from the setSession()/verifyOtp()/updateUser() calls above is not
    // guaranteed to have propagated by the time this request is dispatched;
    // relying on it was causing the server action to silently see no user
    // and skip the activation notification entirely.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await completeAccountSetupAction(session.access_token);
      }
    } catch {
      // Non-blocking — notification failure must not block account setup.
    }

    // Business recovery always returns to the Business/Operator context.
    router.push("/admin/home");
    router.refresh();
  }

  // Loading — checking for a recovery token / existing session
  if (phase === "checking") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </main>
    );
  }

  // token_hash present — wait for an explicit click before verifying, so an
  // email scanner prefetching the link can't consume it first.
  if (phase === "confirm" || phase === "verifying") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Image
              src="/logo.png"
              alt="Happy Hour Compass"
              width={80}
              height={80}
              className="rounded-xl"
            />
          </div>
          <div className="bg-white p-8 rounded-xl shadow-md text-center">
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Reset your password
            </h1>
            <p className="text-sm text-gray-500 mb-5 leading-relaxed">
              Continue to securely reset the password for your Happy Hour
              Compass Business account.
            </p>
            <form onSubmit={handleContinue}>
              <button
                type="submit"
                disabled={phase === "verifying"}
                className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {phase === "verifying" ? "Continuing…" : "Continue to reset password"}
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  // No active session — link expired or already used
  if (phase === "unavailable") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Image
              src="/logo.png"
              alt="Happy Hour Compass"
              width={80}
              height={80}
              className="rounded-xl"
            />
          </div>
          <div className="bg-white p-8 rounded-xl shadow-md text-center">
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Link unavailable
            </h1>
            <p className="text-sm text-gray-500 mb-5">
              This password setup link has expired or has already been used.
              You can request a new link below.
            </p>
            <a
              href="/forgot-password"
              className="text-sm text-amber-600 hover:text-amber-700 font-medium"
            >
              Request a new link →
            </a>
          </div>
        </div>
      </main>
    );
  }

  const inputClass =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Image
            src="/logo.png"
            alt="Happy Hour Compass"
            width={80}
            height={80}
            className="rounded-xl"
          />
        </div>

        <div className="bg-white p-8 rounded-xl shadow-md">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">
              Set your password
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Choose a password for your Happy Hour Compass Business account.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Password
              </label>
              <PasswordInput
                id="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className={inputClass}
              />
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Confirm password
              </label>
              <PasswordInput
                id="confirm-password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                className={inputClass}
              />
            </div>

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {done && (
              <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                Password set — redirecting to your Business dashboard…
              </div>
            )}

            <button
              type="submit"
              disabled={loading || done}
              className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Saving…" : "Set password"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
