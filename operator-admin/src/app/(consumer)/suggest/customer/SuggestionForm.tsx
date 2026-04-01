"use client";

import { useActionState } from "react";
import Link from "next/link";
import { submitSuggestionAction, type SuggestionFormState } from "./actions";

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
        <p className="text-[15px] text-gray-600 leading-relaxed mb-10 max-w-[280px]">
          Thanks &mdash; we&rsquo;ll review this happy hour suggestion soon.
        </p>

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
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
          {state.error}
        </div>
      )}

      <div className="space-y-5">
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

        {/* Your name — optional */}
        <div>
          <label htmlFor="customer_name" className={LABEL_CLASS}>
            Your name{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
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
            Your email{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="customer_email"
            name="customer_email"
            type="email"
            autoComplete="email"
            inputMode="email"
            className={INPUT_CLASS}
          />
          {state.fieldErrors?.customer_email && (
            <p className={FIELD_ERROR_CLASS}>{state.fieldErrors.customer_email}</p>
          )}
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending}
        className="mt-8 w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-[15px] transition-colors"
      >
        {isPending ? "Submitting…" : "Submit suggestion"}
      </button>

      <p className="mt-4 text-center text-[12px] text-gray-400">
        We review all suggestions before adding them to the directory.
      </p>
    </form>
  );
}
