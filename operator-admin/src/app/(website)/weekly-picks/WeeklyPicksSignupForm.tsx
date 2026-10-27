"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { FieldError } from "@/components/FieldError";
import { trackGA4Event } from "@/lib/ga4";
import {
  WEEKLY_PICKS_BUTTON_CONSENT_TEXT,
  WEEKLY_PICKS_CONSENT_TEXT,
  WEEKLY_PICKS_HEADLINE,
  WEEKLY_PICKS_PROMISE,
  WEEKLY_PICKS_PROMISE_COMPACT,
  WEEKLY_PICKS_EMAIL_REQUIRED_MESSAGE,
  WEEKLY_PICKS_EMAIL_INVALID_MESSAGE,
  WEEKLY_PICKS_CONSENT_REQUIRED_MESSAGE,
  WEEKLY_PICKS_GENERIC_ERROR_MESSAGE,
  isValidWeeklyPicksEmail,
  normalizeWeeklyPicksEmail,
  weeklyPicksUsesButtonConsent,
  type WeeklyPicksPlacement,
  type WeeklyPicksSignupState,
} from "@/lib/weeklyPicks/weeklyPicks";
import { subscribeToWeeklyPicks } from "./actions";

/**
 * The one Weekly Picks signup form, used by every placement (/weekly-picks,
 * homepage main + bottom, guide end). Every instance submits through the
 * same subscribeToWeeklyPicks server action; `placement` is the only thing
 * that differs, and it is the only value sent to analytics.
 *
 * Accessibility: noValidate + our own messages (FieldError role="alert",
 * aria-invalid/aria-describedby), focus moves to the first invalid field on
 * a failed submit and to the result heading on success, and a polite live
 * region announces the outcome.
 *
 * Turnstile renders only once the visitor interacts with the form, so the
 * homepage's two forms don't load challenges for every page view.
 *
 * Consent: button-consent placements (the homepage) have no checkbox — the
 * submit button is the consent action, described by the notice beside it,
 * which links to the Privacy Policy's contact section (name, mailing
 * address, email). Every other placement keeps the checkbox and sender line.
 */

/** Same field name as TURNSTILE_TOKEN_FIELD — src/lib/turnstile.ts is server-only. */
const TURNSTILE_TOKEN_FIELD = "cf_turnstile_token";

const TURNSTILE_REQUIRED_MESSAGE = "Please complete the security check below, then try again.";

const SUPPORT_EMAIL = "support@happyhourcompass.com";


type Props = {
  placement: WeeklyPicksPlacement;
  variant: "full" | "compact";
  /** Heading level for the headline — "h1" only on the /weekly-picks page itself. */
  headingAs?: "h1" | "h2";
  /** Omit the headline and promise (the /weekly-picks page renders its own above the form). */
  hideIntro?: boolean;
};

export function WeeklyPicksSignupForm({ placement, variant, headingAs = "h2", hideIntro = false }: Props) {
  const id = useId();
  const emailId = `${id}-email`;
  const consentId = `${id}-consent`;
  const consentNoticeId = `${id}-consent-notice`;
  const buttonConsent = weeklyPicksUsesButtonConsent(placement);

  const [result, setResult] = useState<WeeklyPicksSignupState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const [engaged, setEngaged] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const turnstileRef = useRef<TurnstileHandle>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);

  const fieldErrors = result.status === "error" ? result.fieldErrors : undefined;
  const formMessage = result.status === "error" ? result.message : undefined;

  useEffect(() => {
    if (result.status === "accepted") successHeadingRef.current?.focus();
  }, [result.status]);

  function engage() {
    if (!engaged) setEngaged(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    engage();

    const formData = new FormData(event.currentTarget);
    const email = normalizeWeeklyPicksEmail(String(formData.get("email") ?? ""));
    const consented = formData.get("weekly_picks_consent") === "yes";

    const clientErrors: { email?: string; consent?: string } = {};
    if (!email) clientErrors.email = WEEKLY_PICKS_EMAIL_REQUIRED_MESSAGE;
    else if (!isValidWeeklyPicksEmail(email)) clientErrors.email = WEEKLY_PICKS_EMAIL_INVALID_MESSAGE;
    if (!buttonConsent && !consented) clientErrors.consent = WEEKLY_PICKS_CONSENT_REQUIRED_MESSAGE;

    if (clientErrors.email || clientErrors.consent) {
      setResult({ status: "error", fieldErrors: clientErrors });
      (clientErrors.email ? emailRef : consentRef).current?.focus();
      return;
    }

    if (!turnstileToken) {
      setResult({ status: "error", message: TURNSTILE_REQUIRED_MESSAGE });
      return;
    }

    formData.set(TURNSTILE_TOKEN_FIELD, turnstileToken);

    startTransition(async () => {
      let next: WeeklyPicksSignupState;
      try {
        next = await subscribeToWeeklyPicks(formData);
      } catch {
        next = { status: "error", message: WEEKLY_PICKS_GENERIC_ERROR_MESSAGE };
      }

      if (next.status === "accepted") {
        trackGA4Event("weekly_picks_signup_requested", { placement });
      } else if (next.status === "error") {
        if (next.turnstileFailed) {
          setTurnstileToken(null);
          turnstileRef.current?.reset();
        }
        if (next.fieldErrors?.email) emailRef.current?.focus();
        else if (next.fieldErrors?.consent) consentRef.current?.focus();
      }
      setResult(next);
    });
  }

  const isFull = variant === "full";
  const Heading = headingAs;
  const ResultHeading = headingAs === "h1" ? "h2" : "h3";

  return (
    <div className={isFull ? "" : "md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-10 md:items-start"}>
      {!hideIntro && (
        <div className={isFull ? "mb-6" : "mb-5 md:mb-0"}>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">Weekly Picks</p>
          <Heading
            className={
              isFull
                ? "mt-2 text-2xl md:text-3xl font-bold text-gray-900 tracking-tight leading-snug"
                : "mt-1.5 text-xl md:text-2xl font-bold text-gray-900 tracking-tight leading-snug"
            }
          >
            {WEEKLY_PICKS_HEADLINE}
          </Heading>
          <p className={`mt-2 text-gray-600 leading-relaxed ${isFull ? "text-[15px] md:text-base max-w-xl" : "text-sm"}`}>
            {isFull ? WEEKLY_PICKS_PROMISE : WEEKLY_PICKS_PROMISE_COMPACT}
          </p>
        </div>
      )}

      {/* Polite live region — always mounted so the outcome is announced. */}
      <div role="status" aria-live="polite" className="sr-only">
        {result.status === "accepted" ? "Almost done. Check your inbox for a confirmation link." : ""}
      </div>

      {result.status === "accepted" ? (
        <div className="rounded-2xl bg-white border border-amber-200 px-5 py-5">
          <ResultHeading
            ref={successHeadingRef}
            tabIndex={-1}
            className="text-base font-bold text-gray-900 focus:outline-none"
          >
            Almost done
          </ResultHeading>
          <p className="mt-1.5 text-sm text-gray-600 leading-relaxed">
            Check your inbox for a confirmation link. If you already receive Weekly Picks,
            you&rsquo;re all set. If you need help,{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-800">
              contact us
            </a>
            .
          </p>
        </div>
      ) : (
        <form noValidate onSubmit={handleSubmit} onFocus={engage} aria-label="Weekly Picks signup">
          <input type="hidden" name="placement" value={placement} />

          {formMessage && (
            <div role="alert" className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700">
              {formMessage}
            </div>
          )}

          <div>
            <label htmlFor={emailId} className="block text-sm font-medium text-gray-700 mb-1.5">
              Email address
            </label>
            <input
              ref={emailRef}
              id={emailId}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              aria-required="true"
              aria-invalid={!!fieldErrors?.email}
              aria-describedby={fieldErrors?.email ? `${emailId}-error` : undefined}
              className={`w-full ${isFull ? "sm:max-w-md" : ""} px-3.5 py-3 border border-gray-300 rounded-xl text-[15px] text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent placeholder:text-gray-400`}
            />
            <FieldError id={`${emailId}-error`} message={fieldErrors?.email} />
          </div>

          {/* Permission comes before the button in reading and Tab order. */}
          {!buttonConsent && (
            <div className="mt-4">
              <div className="flex items-start gap-3">
                <input
                  ref={consentRef}
                  id={consentId}
                  name="weekly_picks_consent"
                  type="checkbox"
                  value="yes"
                  aria-required="true"
                  aria-invalid={!!fieldErrors?.consent}
                  aria-describedby={fieldErrors?.consent ? `${consentId}-error` : undefined}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 shrink-0"
                />
                <label htmlFor={consentId} className="text-[13px] text-gray-700 leading-snug cursor-pointer">
                  {WEEKLY_PICKS_CONSENT_TEXT}
                </label>
              </div>
              <FieldError id={`${consentId}-error`} message={fieldErrors?.consent} />
            </div>
          )}

          {engaged && (
            <div className="mt-4">
              <Turnstile
                ref={turnstileRef}
                onVerify={setTurnstileToken}
                onExpire={() => setTurnstileToken(null)}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            aria-describedby={buttonConsent ? consentNoticeId : undefined}
            className="mt-4 w-full sm:w-auto px-6 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl text-[15px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
          >
            {isPending ? "Sending…" : "Send me the weekly picks"}
          </button>

          {buttonConsent ? (
            <p id={consentNoticeId} className="mt-3 text-[13px] text-gray-600 leading-snug">
              {WEEKLY_PICKS_BUTTON_CONSENT_TEXT} See our{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-gray-800">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link href="/privacy#contact" className="underline underline-offset-2 hover:text-gray-800">
                contact details
              </Link>
              .
            </p>
          ) : (
            <p className="mt-3 text-xs text-gray-500 leading-relaxed">
              Sent by Happy Hour Compass ({SUPPORT_EMAIL}). See our{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-gray-700">
                Privacy Policy
              </Link>
              .
            </p>
          )}
        </form>
      )}
    </div>
  );
}
