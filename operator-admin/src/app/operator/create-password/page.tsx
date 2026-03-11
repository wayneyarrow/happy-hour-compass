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
 * Flow:
 *   1. Claimant clicks "Set up my password →" in approval email.
 *   2. Supabase verifies the recovery token and redirects to /auth/callback.
 *   3. /auth/callback exchanges the PKCE code for a session (sets cookies).
 *   4. User is redirected here with an active Supabase session.
 *   5. User sets their password via supabase.auth.updateUser({ password }).
 *   6. User is redirected to /admin/venue — their operator account is ready.
 *
 * Session check: reads from the Supabase browser client (cookie-based session
 * set by the /auth/callback route handler). Shows an error state if no session
 * is present (link expired or already used).
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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
      setSessionChecked(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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
