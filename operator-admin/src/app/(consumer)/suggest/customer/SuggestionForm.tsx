"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { submitSuggestionAction, type SuggestionFormState } from "./actions";
import { trackEvent } from "@/lib/analytics";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";

const INPUT_CLASS =
  "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "placeholder:text-gray-400";

const LABEL_CLASS = "block text-sm font-medium text-gray-700 mb-1.5";
const FIELD_ERROR_CLASS = "mt-1.5 text-xs text-red-600";

export function SuggestionForm() {
  const [state, formAction, isPending] = useActionState<SuggestionFormState, FormData>(
    submitSuggestionAction,
    {}
  );
  const [emailValue, setEmailValue] = useState("");
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  useEffect(() => {
    trackEvent("suggest_venue_started");
  }, []);

  useEffect(() => {
    if (state.turnstileFailed) {
      setTurnstileToken(null);
      turnstileRef.current?.reset();
    }
  }, [state.turnstileFailed]);

  // ── Success state ─────────────────────────────────────────────────────────
  if (state.success) {
    return (
      <div className="px-5 pt-10 pb-12 flex flex-col items-center text-center">
        {/* Checkmark badge */}
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-6">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#16a34a"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-8 h-8"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h2 className="text-[20px] font-bold text-gray-900 mb-4 leading-snug">
          Thanks for the tip!
        </h2>
        <p className="text-[15px] text-gray-600 leading-relaxed mb-6 max-w-[280px]">
          We&rsquo;ll review the suggestion and may add it to the directory if
          it looks like a good fit.
        </p>

        {emailValue && (
          <p className="text-[13px] text-gray-500 leading-relaxed mb-8 max-w-[280px]">
            Check your inbox for a confirmation email. If you don&rsquo;t see
            it, check your spam or junk folder.
          </p>
        )}

        <Link
          href="/"
          className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl text-[15px] transition-colors"
        >
          Back to search
        </Link>
      </div>
    );
  }

  // ── Suggestion form ───────────────────────────────────────────────────────
  return (
    <form action={formAction} className="px-5 pt-6 pb-12">
      {/* General error banner */}
      {state.error && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700">
          {state.error}
        </div>
      )}

      {/* Section 1 — Venue details */}
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-gray-400 mb-4">
          About the venue
        </p>
        <div className="space-y-4">
          {/* Place name */}
          <div>
            <label htmlFor="name" className={LABEL_CLASS}>
              Business name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="off"
              placeholder="e.g. The Keg Steakhouse"
              required
              className={INPUT_CLASS}
            />
            {state.fieldErrors?.name && (
              <p className={FIELD_ERROR_CLASS}>{state.fieldErrors.name}</p>
            )}
          </div>

          {/* City */}
          <div>
            <label htmlFor="city" className={LABEL_CLASS}>
              City <span className="text-red-500">*</span>
            </label>
            <input
              id="city"
              name="city"
              type="text"
              autoComplete="address-level2"
              placeholder="e.g. Vancouver"
              required
              className={INPUT_CLASS}
            />
            {state.fieldErrors?.city && (
              <p className={FIELD_ERROR_CLASS}>{state.fieldErrors.city}</p>
            )}
          </div>

          {/* Notes — optional */}
          <div>
            <label htmlFor="notes" className={LABEL_CLASS}>
              Notes{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              placeholder="e.g. Great $5 beers on weekdays 4–6 PM"
              className={INPUT_CLASS + " resize-none"}
            />
          </div>
        </div>
      </div>

      {/* Section divider */}
      <div className="border-t border-gray-100 mb-6" />

      {/* Section 2 — Your info */}
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-gray-400 mb-4">
          About you <span className="font-normal normal-case tracking-normal text-gray-300">— optional</span>
        </p>
        <div className="space-y-4">
          {/* Your name — optional */}
          <div>
            <label htmlFor="customer_name" className={LABEL_CLASS}>
              Your name
            </label>
            <input
              id="customer_name"
              name="customer_name"
              type="text"
              autoComplete="name"
              className={INPUT_CLASS}
            />
          </div>

          {/* Your email — optional */}
          <div>
            <label htmlFor="customer_email" className={LABEL_CLASS}>
              Your email
            </label>
            <input
              id="customer_email"
              name="customer_email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
              className={INPUT_CLASS}
            />
            {state.fieldErrors?.customer_email && (
              <p className={FIELD_ERROR_CLASS}>{state.fieldErrors.customer_email}</p>
            )}
          </div>

          {/* Marketing opt-in — only shown when an email is entered */}
          {emailValue && (
            <div className="flex items-start gap-3 pt-1">
              <input
                id="email_marketing_opt_in"
                name="email_marketing_opt_in"
                type="checkbox"
                value="true"
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 shrink-0"
              />
              <label
                htmlFor="email_marketing_opt_in"
                className="text-[13px] text-gray-600 leading-snug cursor-pointer"
              >
                Email me occasional updates from Happy Hour Compass.
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Turnstile */}
      <div className="mb-5">
        <Turnstile
          ref={turnstileRef}
          onVerify={setTurnstileToken}
          onExpire={() => setTurnstileToken(null)}
        />
        <input type="hidden" name="cf_turnstile_token" value={turnstileToken ?? ""} />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending || !turnstileToken}
        className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl text-[15px] transition-colors"
      >
        {isPending ? "Submitting…" : "Submit suggestion"}
      </button>

      <p className="mt-4 text-center text-[12px] text-gray-400 leading-relaxed">
        By submitting, you agree to our{" "}
        <a href="/terms" className="underline hover:text-gray-600 transition-colors">Terms of Service</a>
        {" "}and{" "}
        <a href="/privacy" className="underline hover:text-gray-600 transition-colors">Privacy Policy</a>.
      </p>
      <p className="mt-2 text-center text-[12px] text-gray-400">
        We review all suggestions before adding them to the directory.
      </p>
    </form>
  );
}
