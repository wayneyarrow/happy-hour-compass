"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { acceptInviteAction } from "./actions";
import PasswordInput from "@/components/PasswordInput";

type Props = {
  token:     string;
  email:     string;
  firstName: string;
  lastName:  string;
};

export default function InviteAcceptForm({
  token,
  email,
  firstName: initialFirstName,
  lastName:  initialLastName,
}: Props) {
  const router   = useRouter();
  const supabase = createClient();

  // ── Session-check state ───────────────────────────────────────────────────
  // On mount we check whether the browser already has an active Supabase
  // session. If it belongs to a different email we sign it out immediately
  // so the invite is always accepted under the correct identity.
  const [sessionCheckDone, setSessionCheckDone] = useState(false);
  const [signedOutEmail,   setSignedOutEmail]   = useState<string | null>(null);

  // ── Form state ────────────────────────────────────────────────────────────
  const [firstName,       setFirstName]       = useState(initialFirstName);
  const [lastName,        setLastName]        = useState(initialLastName);
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error,           setError]           = useState<string | null>(null);
  const [existingUser,    setExistingUser]    = useState(false);
  const [isPending,       startTransition]    = useTransition();

  // ── Session guard (runs once on mount) ────────────────────────────────────
  useEffect(() => {
    async function checkAndCleanSession() {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (currentUser && currentUser.email?.toLowerCase() !== email.toLowerCase()) {
        // Wrong account is active — sign it out so the invite is accepted as
        // the correct email. We store the old email for the dismissible notice.
        await supabase.auth.signOut();
        setSignedOutEmail(currentUser.email ?? "another account");
      }

      setSessionCheckDone(true);
    }

    checkAndCleanSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Submit handler ────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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

    const submittedPassword = password;

    startTransition(async () => {
      const formData = new FormData();
      formData.set("token",            token);
      formData.set("first_name",       firstName);
      formData.set("last_name",        lastName);
      formData.set("password",         submittedPassword);
      formData.set("confirm_password", confirmPassword);

      const result = await acceptInviteAction({}, formData);

      if (result.existingUser) {
        // Email already has a Supabase auth account. The membership has been
        // activated server-side. The user needs to sign in with that email.
        // Any wrong session was already cleared by the mount effect.
        setExistingUser(true);
        return;
      }

      if (result.error) {
        setError(result.error);
        return;
      }

      // Account created — sign in and confirm the resulting session belongs
      // to the invited email before navigating into the admin.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: submittedPassword,
      });

      if (signInError) {
        setError(
          "Your account was created, but sign-in failed. " +
            "Please go to the sign-in page and log in with your new password."
        );
        return;
      }

      // Double-check: the active session must belong to the invited email.
      const { data: { user: signedInUser } } = await supabase.auth.getUser();
      if (signedInUser?.email?.toLowerCase() !== email.toLowerCase()) {
        await supabase.auth.signOut();
        setError(
          "A session mismatch was detected after sign-in. " +
            "Please sign in manually at the sign-in page."
        );
        return;
      }

      router.push("/admin/home");
      router.refresh();
    });
  }

  const inputClass =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

  // ── Loading (session check) ───────────────────────────────────────────────
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
          Your invite has been activated for <strong>{email}</strong>.
          Sign in with that email to join the team.
        </div>
        <a
          href="/login"
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
      {/* Signed-out notice */}
      {signedOutEmail && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          We signed you out of <strong>{signedOutEmail}</strong> so you can
          accept this invite as <strong>{email}</strong>.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="first-name" className="block text-sm font-medium text-gray-700 mb-1">
              First name
            </label>
            <input
              id="first-name"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="last-name" className="block text-sm font-medium text-gray-700 mb-1">
              Last name
            </label>
            <input
              id="last-name"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

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
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
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

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Creating account…" : "Accept invitation"}
        </button>
      </form>
    </div>
  );
}
