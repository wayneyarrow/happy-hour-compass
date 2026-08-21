"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";
import { createConsumerAccount } from "./actions";
import { EmailConfirmationNote } from "@/app/(website)/acquisition/emailConfirmationCopy";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { trackGA4Event } from "@/lib/ga4";

const isDev = process.env.NODE_ENV === "development";

function devLog(...args: unknown[]) {
  if (isDev) console.log("[signup]", ...args);
}

const INPUT_CLASS =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent";

const CHECKBOX_CLASS =
  "mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 cursor-pointer";

export default function SignUpPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

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
    if (!agreeTerms || !agreePrivacy) {
      setError("You must agree to the Terms of Service and Privacy Policy.");
      return;
    }

    const trimmedFirstName = firstName.trim();
    if (!trimmedFirstName) {
      setError("Please enter your first name.");
      return;
    }

    setLoading(true);
    devLog("signup started for email:", email);

    // Fires once client-side validation has passed and a real submission is
    // about to be sent — not on page load, not on a validation-only retry
    // (those all return above, before this line).
    trackGA4Event("consumer_signup_started");

    const trimmedLastName = lastName.trim() || null;

    const result = await createConsumerAccount({
      email,
      password,
      firstName: trimmedFirstName,
      lastName: trimmedLastName,
      marketingConsent,
      turnstileToken,
    });

    devLog("createConsumerAccount result:", result);

    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      if (result.turnstileFailed) {
        setTurnstileToken(null);
        turnstileRef.current?.reset();
      }
      return;
    }

    // Only count a genuinely new account here — a resubmission for a still-
    // unconfirmed email behaves like a confirmation resend (see
    // createConsumerAccount's doc comment) and must not be double-counted as
    // a new completed signup.
    if (result.isNewSignup) {
      trackGA4Event("consumer_signup_completed");
    }

    setSuccessEmail(email);
    setLoading(false);
  }

  if (successEmail) {
    return (
      <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-8 text-center">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Check your email</h2>
        <p className="text-sm text-gray-500 leading-relaxed mb-3">
          We sent a confirmation link to{" "}
          <span className="font-medium text-gray-700">{successEmail}</span>.
        </p>
        <div className="mb-6 mx-auto max-w-[290px]">
          <EmailConfirmationNote lead="Click the link to activate your account." />
        </div>
        <Link
          href="/sign-in"
          className="text-sm text-amber-600 hover:text-amber-700 font-medium"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
        <p className="text-sm text-gray-500 mt-1">
          Free forever. No credit card required.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* First + Last name */}
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
              placeholder="First name"
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label
              htmlFor="last-name"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Last name{" "}
              <span className="text-gray-400 font-normal text-xs">(optional)</span>
            </label>
            <input
              id="last-name"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className={INPUT_CLASS}
            />
          </div>
        </div>

        {/* Email */}
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
            placeholder="you@example.com"
            className={INPUT_CLASS}
          />
        </div>

        {/* Password */}
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
            className={INPUT_CLASS}
          />
        </div>

        {/* Confirm Password */}
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
            className={INPUT_CLASS}
          />
        </div>

        {/* Consent checkboxes */}
        <div className="space-y-3 pt-2 border-t border-gray-100">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              required
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className={CHECKBOX_CLASS}
            />
            <span className="text-sm text-gray-600 leading-snug">
              I agree to the{" "}
              <Link
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 hover:underline font-medium"
              >
                Terms of Service
              </Link>
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              required
              checked={agreePrivacy}
              onChange={(e) => setAgreePrivacy(e.target.checked)}
              className={CHECKBOX_CLASS}
            />
            <span className="text-sm text-gray-600 leading-snug">
              I agree to the{" "}
              <Link
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-600 hover:underline font-medium"
              >
                Privacy Policy
              </Link>
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
              className={CHECKBOX_CLASS}
            />
            <span className="text-sm text-gray-500 leading-snug">
              Send me occasional Happy Hour Compass updates, recommendations, and
              special offers. I can unsubscribe anytime.
            </span>
          </label>
        </div>

        {error && (
          <div
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
          >
            {error}
          </div>
        )}

        <Turnstile
          ref={turnstileRef}
          onVerify={setTurnstileToken}
          onExpire={() => setTurnstileToken(null)}
        />

        <button
          type="submit"
          disabled={loading || !turnstileToken}
          className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="text-amber-600 hover:text-amber-700 font-medium"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
