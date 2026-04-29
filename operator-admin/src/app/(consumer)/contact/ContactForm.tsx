"use client";

import { useActionState, useEffect } from "react";
import { submitContactAction, type ContactFormState } from "./actions";
import { trackEvent } from "@/lib/analytics";

const INPUT_CLASS =
  "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "placeholder:text-gray-400";
const LABEL_CLASS = "block text-sm font-medium text-gray-700 mb-1.5";
const FIELD_ERROR_CLASS = "mt-1.5 text-xs text-red-600";

export function ContactForm() {
  const [state, formAction, isPending] = useActionState<ContactFormState, FormData>(
    submitContactAction,
    {}
  );

  useEffect(() => {
    trackEvent("contact_us_started");
  }, []);

  useEffect(() => {
    if (state.success) trackEvent("contact_us_submitted");
  }, [state.success]);

  if (state.success) {
    return (
      <div className="px-5 pt-10 pb-12 flex flex-col items-center text-center">
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
        <h2 className="text-[20px] font-bold text-gray-900 mb-4">Message sent!</h2>
        <p className="text-[15px] text-gray-600 leading-relaxed max-w-[280px]">
          Thanks &mdash; we&rsquo;ve received your message and will get back to you.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="px-5 pt-6 pb-12">
      {state.error && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
          {state.error}
        </div>
      )}

      <div className="space-y-5">
        <div>
          <label htmlFor="name" className={LABEL_CLASS}>
            Name{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Your name"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="email" className={LABEL_CLASS}>
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            required
            className={INPUT_CLASS}
          />
          {state.fieldErrors?.email && (
            <p className={FIELD_ERROR_CLASS}>{state.fieldErrors.email}</p>
          )}
        </div>

        <div>
          <label htmlFor="message" className={LABEL_CLASS}>
            Message <span className="text-red-500">*</span>
          </label>
          <textarea
            id="message"
            name="message"
            rows={5}
            placeholder="How can we help?"
            required
            className={INPUT_CLASS + " resize-none"}
          />
          {state.fieldErrors?.message && (
            <p className={FIELD_ERROR_CLASS}>{state.fieldErrors.message}</p>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="mt-8 w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-[15px] transition-colors"
      >
        {isPending ? "Sending…" : "Send Message"}
      </button>
    </form>
  );
}
