"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import PasswordInput from "@/components/PasswordInput";

const INPUT_CLASS =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

// "checking": initial load, determining which recovery path (if any) applies.
// "confirm": a token_hash link was opened — waiting on the user's explicit
//   action before calling verifyOtp() (see handleContinue below for why).
// "verifying": the user has clicked Continue; the one-time verifyOtp() call
//   is in flight.
// "form": a session is established (via verifyOtp() or the legacy
//   hash-fragment path) — show the new-password form.
// "unavailable": no usable session — link expired, already used, or invalid.
type Phase = "checking" | "confirm" | "verifying" | "form" | "unavailable";

export default function ConsumerResetPasswordPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("checking");
  const [pendingTokenHash, setPendingTokenHash] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // In-memory guard against a double click/Enter firing verifyOtp() twice —
  // recovery tokens are single-use, so a second call would always fail.
  // Checked synchronously, so it closes the gap before the disabled-button
  // re-render takes effect.
  const verifyingRef = useRef(false);

  useEffect(() => {
    async function init() {
      const supabase = createClient();

      // Path A: token_hash query param — the Reset Password email template
      // builds the link as {{ .RedirectTo }}?token_hash={{ .TokenHash }}
      // &type=recovery. Supabase documents email-security scanners
      // prefetching links as a common cause of single-use recovery tokens
      // being silently consumed before the user ever opens the message —
      // confirmed here directly (a fresh, never-manually-reused token
      // sometimes already reads as "expired" on click). Loading this page
      // must NOT call verifyOtp() for that reason: capture the token and
      // wait for an explicit user action (handleContinue) instead of
      // verifying automatically.
      const searchParams = new URLSearchParams(window.location.search);
      const tokenHash = searchParams.get("token_hash");
      const otpType = searchParams.get("type");

      if (tokenHash && otpType === "recovery") {
        setPendingTokenHash(tokenHash);
        setPhase("confirm");
        return;
      }

      // Path B: hash-fragment recovery token — legacy format, kept for any
      // reset email already sent before the token_hash template change.
      const hash = window.location.hash.slice(1);
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

          // Remove tokens from address bar.
          window.history.replaceState(null, "", window.location.pathname);

          setPhase(sessionError ? "unavailable" : "form");
          return;
        }
      }

      // Path C: pre-existing cookie session (e.g. page refresh after a
      // successful verifyOtp() below, or after the hash-fragment exchange
      // above).
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setPhase(session ? "form" : "unavailable");
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();

    if (verifyingRef.current || !pendingTokenHash) return;
    verifyingRef.current = true;
    setPhase("verifying");

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: pendingTokenHash,
      type: "recovery",
    });

    // Remove the token from the address bar now that it's been used.
    window.history.replaceState(null, "", window.location.pathname);

    setPhase(verifyError ? "unavailable" : "form");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setDone(true);
    router.push("/account");
    router.refresh();
  }

  if (phase === "checking") {
    return (
      <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-8 text-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (phase === "confirm" || phase === "verifying") {
    return (
      <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Reset your password</h1>
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">
          Continue to securely reset the password for your Happy Hour Compass account.
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
    );
  }

  if (phase === "unavailable") {
    return (
      <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Link unavailable</h1>
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">
          This password reset link has expired or has already been used.
          Request a new one below.
        </p>
        <Link
          href="/account/forgot-password"
          className="text-sm text-amber-600 hover:text-amber-700 font-medium"
        >
          Request a new link →
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Set a new password</h1>
        <p className="text-sm text-gray-500 mt-1">
          Choose a strong password for your account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            New password
          </label>
          <PasswordInput
            id="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 8 characters"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Confirm new password
          </label>
          <PasswordInput
            id="confirm-password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your password"
            className={INPUT_CLASS}
          />
        </div>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {done && (
          <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            Password updated — redirecting…
          </div>
        )}

        <button
          type="submit"
          disabled={loading || done}
          className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving…" : "Set new password"}
        </button>
      </form>
    </div>
  );
}
