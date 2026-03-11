"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

/**
 * /operator/create-password
 *
 * Password setup page for newly onboarded operators arriving via the
 * Supabase recovery link sent at claim approval time.
 *
 * Session flow (hash-fragment / implicit):
 *   1. Claimant clicks "Set up my password →" in approval email.
 *   2. Supabase's /auth/v1/verify verifies the recovery token.
 *   3. Supabase redirects here with tokens in the URL hash:
 *        /operator/create-password#access_token=...&refresh_token=...&type=recovery
 *   4. @supabase/ssr's createBrowserClient detects the hash asynchronously and
 *      fires SIGNED_IN via onAuthStateChange. A concurrent getSession() call
 *      catches the session if hash processing finishes first.
 *   5. Once a session is confirmed, the password form is shown.
 *   6. On submit: supabase.auth.updateUser({ password }).
 *   7. Redirect to /admin/venue — operator account is ready.
 *
 * The session detection uses a "first-wins" race between getSession() and
 * onAuthStateChange to handle both hash tokens and pre-existing sessions
 * (e.g., page refreshed after a partial flow).
 */
export default function CreatePasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // "First-wins" race between two paths so we handle both:
    //   A) Hash-fragment session (#access_token=...) — Supabase detects this
    //      asynchronously and fires SIGNED_IN via onAuthStateChange.
    //   B) Pre-existing cookie session (e.g. page refresh) — getSession()
    //      returns immediately.
    // Whichever resolves first settles the state; the other is ignored.
    let settled = false;

    function settle(session: boolean) {
      if (settled) return;
      settled = true;
      setHasSession(session);
      setSessionChecked(true);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
          settle(!!session);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      settle(!!session);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
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
    router.push("/admin/venue");
    router.refresh();
  }

  // Loading — checking session
  if (!sessionChecked) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </main>
    );
  }

  // No active session — link expired or already used
  if (!hasSession) {
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
              Please contact us if you need a new link.
            </p>
            <a
              href="/login"
              className="text-sm text-amber-600 hover:text-amber-700 font-medium"
            >
              Go to sign in
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
              Choose a password to complete your operator account setup.
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
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
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
              <input
                id="confirm-password"
                type="password"
                required
                minLength={6}
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
                Password set — redirecting to your venue…
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
