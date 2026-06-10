"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { acceptCpInviteAction } from "./actions";
import PasswordInput from "@/components/PasswordInput";

type Props = {
  token: string;
  email: string;
};

export default function AcceptCpInviteForm({ token, email }: Props) {
  const router   = useRouter();
  const supabase = createClient();

  // ── Session guard ─────────────────────────────────────────────────────────
  const [sessionCheckDone, setSessionCheckDone] = useState(false);
  const [signedOutEmail,   setSignedOutEmail]   = useState<string | null>(null);

  useEffect(() => {
    async function checkSession() {
      const { data: { user: current } } = await supabase.auth.getUser();
      if (current && current.email?.toLowerCase() !== email.toLowerCase()) {
        await supabase.auth.signOut();
        setSignedOutEmail(current.email ?? "another account");
      }
      setSessionCheckDone(true);
    }
    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Form state ────────────────────────────────────────────────────────────
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error,           setError]           = useState<string | null>(null);
  const [existingUser,    setExistingUser]    = useState(false);
  const [isPending,       startTransition]    = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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

    const submittedPassword = password;

    startTransition(async () => {
      const formData = new FormData();
      formData.set("token",            token);
      formData.set("password",         submittedPassword);
      formData.set("confirm_password", confirmPassword);

      const result = await acceptCpInviteAction({}, formData);

      if (result.existingUser) {
        setExistingUser(true);
        return;
      }

      if (result.error) {
        setError(result.error);
        return;
      }

      // New account created — sign in and redirect to CP.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: submittedPassword,
      });

      if (signInError) {
        setError(
          "Your account was created, but sign-in failed. " +
            "Please go to /control-panel-login and sign in with your new password."
        );
        return;
      }

      router.push("/control-panel/dashboard");
      router.refresh();
    });
  }

  const inputClass =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

  if (!sessionCheckDone) {
    return (
      <div className="py-6 text-center text-sm text-gray-400">
        Preparing your invite…
      </div>
    );
  }

  // ── Existing account state ────────────────────────────────────────────────
  if (existingUser) {
    return (
      <div className="space-y-4">
        <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 leading-relaxed">
          <strong className="block mb-1">You already have an account</strong>
          Your admin access has been activated for <strong>{email}</strong>.
          Sign in to access the Control Panel.
        </div>
        <a
          href="/control-panel-login"
          className="block w-full text-center py-2 px-4 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm transition-colors"
        >
          Sign in as {email} →
        </a>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {signedOutEmail && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          We signed you out of <strong>{signedOutEmail}</strong> so you can
          accept this invite as <strong>{email}</strong>.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email — locked to invite address */}
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            readOnly
            className={`${inputClass} bg-gray-50 text-gray-500 cursor-not-allowed`}
          />
          <p className="text-xs text-gray-400 mt-1">
            This email matches your invitation and cannot be changed.
          </p>
        </div>

        {/* Password */}
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
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

        {/* Confirm password */}
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
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

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Activating account…" : "Accept invitation"}
        </button>
      </form>
    </div>
  );
}
