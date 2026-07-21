"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitContactAction, type ContactFormState } from "@/app/(consumer)/contact/actions";
import { trackEvent } from "@/lib/analytics";
import { EmailConfirmationNote } from "./emailConfirmationCopy";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";

type Props = {
  onDone: () => void;
};

const INPUT_CLASS =
  "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "placeholder:text-gray-400";
const LABEL_CLASS = "block text-sm font-medium text-gray-700 mb-1.5";
const FIELD_ERROR_CLASS = "mt-1.5 text-xs text-red-600";

/**
 * Contact Us form adapted for the AcquisitionModal context.
 *
 * Reuses submitContactAction (unchanged), all field names, all server-side
 * validation, emails, and Slack notifications. Only the success CTA differs:
 * instead of leaving the user with no action, it calls onDone() to close the
 * modal and return them to exactly where they were on the website.
 */
export function ContactUsModalContent({ onDone }: Props) {
  const [state, formAction, isPending] = useActionState<ContactFormState, FormData>(
    submitContactAction,
    {}
  );
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  useEffect(() => {
    trackEvent("contact_us_started");
  }, []);

  useEffect(() => {
    if (state.success) trackEvent("contact_us_submitted");
  }, [state.success]);

  useEffect(() => {
    if (state.turnstileFailed) {
      setTurnstileToken(null);
      turnstileRef.current?.reset();
    }
  }, [state.turnstileFailed]);

  // ── Success state ─────────────────────────────────────────────────────────
  if (state.success) {
    return (
      <div className="px-6 py-10 flex flex-col items-center text-center">
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

        <h3 className="text-[20px] font-bold text-gray-900 mb-4 leading-snug">
          Message sent!
        </h3>
        <p className="text-[15px] text-gray-600 leading-relaxed mb-6 max-w-[280px]">
          Thanks &mdash; we&rsquo;ve received your message and will get back to
          you.
        </p>
        <div className="mb-10">
          <EmailConfirmationNote lead="We&rsquo;ve sent a confirmation to your inbox." />
        </div>

        <button
          type="button"
          onClick={onDone}
          className="px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-[15px] transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  // ── Contact form ──────────────────────────────────────────────────────────
  return (
    <form action={formAction} className="px-6 pt-5 pb-8">
      {state.error && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700">
          {state.error}
        </div>
      )}

      <div className="space-y-5">
        <div>
          <label htmlFor="cum-name" className={LABEL_CLASS}>
            Name{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="cum-name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Your name"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="cum-email" className={LABEL_CLASS}>
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="cum-email"
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
          <label htmlFor="cum-message" className={LABEL_CLASS}>
            Message <span className="text-red-500">*</span>
          </label>
          <textarea
            id="cum-message"
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

      <div className="mt-5">
        <Turnstile
          ref={turnstileRef}
          onVerify={setTurnstileToken}
          onExpire={() => setTurnstileToken(null)}
        />
        <input type="hidden" name="cf_turnstile_token" value={turnstileToken ?? ""} />
      </div>

      <button
        type="submit"
        disabled={isPending || !turnstileToken}
        className="mt-8 w-full py-3.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl text-[15px] transition-colors"
      >
        {isPending ? "Sending…" : "Send Message"}
      </button>
    </form>
  );
}
