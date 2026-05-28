"use client";

import { useActionState } from "react";
import { forgotPasswordAction } from "./actions";

type Props = {
  showLinkExpiredMessage: boolean;
};

export default function ForgotPasswordForm({ showLinkExpiredMessage }: Props) {
  const [state, formAction, isPending] = useActionState(forgotPasswordAction, {});

  if (state.success) {
    return (
      <div className="text-center">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Check your email</h2>
        <p className="text-sm text-gray-500 mb-6">
          If an operator account exists for that email, a password reset link has been sent.
          Check your inbox — the link expires in 24 hours.
        </p>
        <a
          href="/login"
          className="text-sm text-amber-600 hover:text-amber-700 font-medium"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reset your password</h1>
        <p className="text-sm text-gray-500 mt-1">
          Enter the email address on your operator account and we&rsquo;ll send you a reset link.
        </p>
      </div>

      {showLinkExpiredMessage && (
        <div className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Your setup link may have expired. Enter your email below to request a new one.
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            placeholder="operator@example.com"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
          />
          {state.fieldError && (
            <p className="mt-1 text-xs text-red-600">{state.fieldError}</p>
          )}
        </div>

        {state.error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {state.error}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <div className="mt-6 text-center">
        <a
          href="/login"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Back to sign in
        </a>
      </div>
    </>
  );
}
