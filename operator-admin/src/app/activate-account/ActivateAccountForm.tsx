"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { activateAccountAction } from "./actions";

type Props = {
  token: string;
  email: string;
  firstName: string;
  lastName: string;
};

export default function ActivateAccountForm({
  token,
  email,
  firstName: initialFirstName,
  lastName: initialLastName,
}: Props) {
  const router = useRouter();
  const supabase = createClient();

  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Client-side password validation (server re-validates too)
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    // Capture password in a local const so it's available in the async closure
    const submittedPassword = password;

    startTransition(async () => {
      const formData = new FormData();
      formData.set("token", token);
      formData.set("email", email);
      formData.set("first_name", firstName);
      formData.set("last_name", lastName);
      formData.set("password", submittedPassword);
      formData.set("confirm_password", confirmPassword);

      // Server action: create auth user + operator row + link venue
      const result = await activateAccountAction({}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }

      // Account created — establish browser session via signInWithPassword.
      // This sets the Supabase session cookie so middleware and server
      // components see the user as authenticated.
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

      router.push("/admin/venue");
      router.refresh();
    });
  }

  const inputClass =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="first-name"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            First name
          </label>
          <input
            id="first-name"
            type="text"
            required
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="last-name"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Last name
          </label>
          <input
            id="last-name"
            type="text"
            required
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Email — locked; tied to the claim */}
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
          value={email}
          readOnly
          className={`${inputClass} bg-gray-50 text-gray-500 cursor-not-allowed`}
        />
        <p className="text-xs text-gray-400 mt-1">
          This email matches your venue claim and cannot be changed.
        </p>
      </div>

      {/* Password */}
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

      {/* Confirm password */}
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

      {/* Error */}
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
