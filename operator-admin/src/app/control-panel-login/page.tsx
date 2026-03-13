"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { checkIsControlPanelAdmin } from "./actions";

/**
 * /control-panel-login
 *
 * Dedicated sign-in page for Platform Admin access.
 * Lives OUTSIDE /control-panel/* so the protected layout does not wrap it
 * and create a redirect loop for unauthenticated users.
 *
 * Sign-up is intentionally omitted — platform admins are allowlisted by email
 * via CONTROL_PANEL_ADMIN_EMAILS; they cannot self-register here.
 *
 * Auth flow:
 *   1. signInWithPassword succeeds → session is established.
 *   2. checkIsControlPanelAdmin() (server action) reads the session and checks
 *      the CONTROL_PANEL_ADMIN_EMAILS allowlist (server-only env var).
 *   3. Allowlisted  → redirect to /control-panel.
 *      Not allowed  → sign out immediately + show error; user stays on this page.
 */
export default function ControlPanelLoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
      return;
    }

    const isAdmin = await checkIsControlPanelAdmin();

    if (!isAdmin) {
      await supabase.auth.signOut();
      setErrorMsg("This account does not have access to the Admin Control Panel.");
      setLoading(false);
      return;
    }

    router.push("/control-panel");
    router.refresh();
  }

  const inputClass =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Image
            src="/hhc-icon.png"
            alt="Happy Hour Compass"
            width={48}
            height={48}
            className="rounded-xl"
          />
        </div>

        <div className="bg-white p-8 rounded-xl shadow-md">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Admin Control Panel</h1>
            <p className="text-xs text-gray-400 mt-2">
              Sign in with an authorised administrator account.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className={inputClass}
              />
            </div>

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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
            </div>

            {errorMsg && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
