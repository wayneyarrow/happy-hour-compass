"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import {
  APIProvider,
  Map,
  Marker,
} from "@vis.gl/react-google-maps";
import {
  lookupBusinessAction,
  saveOperatorSubmissionAction,
} from "@/app/(consumer)/suggest/owner/actions";
import type { OwnerFormValues, GoogleMatch } from "@/app/(consumer)/suggest/owner/types";
import { trackEvent } from "@/lib/analytics";
import { EmailConfirmationNote } from "./emailConfirmationCopy";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";

type Props = {
  onDone: () => void;
};

type Step =
  | "form"
  | "looking-up"
  | "match"
  | "no-match"
  | "reject-form"
  // Google business match confirmed — venue auto-provisioned, account email sent.
  | "confirmed"
  // No Google match, or submitter flagged the match as wrong — details
  // submitted for manual review (no account is provisioned yet).
  | "submitted";

const INPUT_CLASS =
  "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "placeholder:text-gray-400";
const LABEL_CLASS = "block text-sm font-medium text-gray-700 mb-1.5";
const FIELD_ERROR_CLASS = "mt-1.5 text-xs text-red-600";
const BTN_PRIMARY =
  "w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 " +
  "disabled:cursor-not-allowed text-white font-semibold rounded-xl text-[15px] transition-colors";
const BTN_SECONDARY =
  "w-full py-3 bg-white hover:bg-gray-50 disabled:opacity-60 " +
  "disabled:cursor-not-allowed text-gray-700 font-semibold rounded-xl text-[15px] " +
  "border border-gray-200 transition-colors";

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className={FIELD_ERROR_CLASS}>{msg}</p>;
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-4"
    >
      <svg
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 19l-7-7 7-7"
        />
      </svg>
      Back
    </button>
  );
}

function ConfirmationMap({ lat, lng }: { lat: number; lng: number }) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  if (!apiKey) return null;

  return (
    <div style={{ height: 160, overflow: "hidden" }}>
      <APIProvider apiKey={apiKey} version="quarterly">
        <Map
          defaultCenter={{ lat, lng }}
          defaultZoom={16}
          gestureHandling="none"
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          cameraControl={false}
          zoomControl={false}
          clickableIcons={false}
        >
          <Marker position={{ lat, lng }} />
        </Map>
      </APIProvider>
    </div>
  );
}

/**
 * Add Your Venue form adapted for the AcquisitionModal context.
 *
 * Reuses lookupBusinessAction and saveOperatorSubmissionAction (unchanged),
 * all field names, all validation, and the complete multi-step flow.
 * Only the success CTA differs: instead of navigating away, it calls
 * onDone() to close the modal and return the user to where they were.
 */
export function AddVenueModalContent({ onDone }: Props) {
  const [step, setStep] = useState<Step>("form");
  const [formValues, setFormValues] = useState<OwnerFormValues | null>(null);
  const [match, setMatch] = useState<GoogleMatch | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  useEffect(() => {
    trackEvent("operator_submission_started");
  }, []);

  /**
   * Handles a saveOperatorSubmissionAction result that failed Turnstile
   * verification — resets the widget (shown on whichever step the submit
   * button lives on) so the user can retry, distinct from an ordinary
   * error which leaves the already-valid token in place.
   */
  function handleTurnstileFailure(message: string) {
    setGeneralError(message);
    setTurnstileToken(null);
    turnstileRef.current?.reset();
  }

  function handleFormSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);

    const values: OwnerFormValues = {
      businessName:  (data.get("business_name")  as string)?.trim() ?? "",
      streetAddress: (data.get("street_address") as string)?.trim() ?? "",
      city:          (data.get("city")           as string)?.trim() ?? "",
      province:      (data.get("province")       as string)?.trim() ?? "",
      firstName:     (data.get("first_name")     as string)?.trim() ?? "",
      lastName:      (data.get("last_name")      as string)?.trim() ?? "",
      position:      (data.get("position")       as string)?.trim() ?? "",
      email:         (data.get("email")          as string)?.trim().toLowerCase() ?? "",
    };

    const errors: Record<string, string> = {};
    if (!values.businessName)  errors.business_name  = "Required";
    if (!values.streetAddress) errors.street_address = "Required";
    if (!values.city)          errors.city           = "Required";
    if (!values.province)      errors.province       = "Required";
    if (!values.firstName)     errors.first_name     = "Required";
    if (!values.lastName)      errors.last_name      = "Required";
    if (!values.position)      errors.position       = "Required";
    if (!values.email) {
      errors.email = "Required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
      errors.email = "Please enter a valid email address";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setGeneralError(null);
    setFormValues(values);
    setStep("looking-up");

    startTransition(async () => {
      try {
        const result = await lookupBusinessAction(data);
        if (result.fieldErrors) {
          setFieldErrors(result.fieldErrors);
          setStep("form");
          return;
        }
        if (result.match) {
          setMatch(result.match);
          setStep("match");
        } else {
          setStep("no-match");
        }
      } catch {
        setGeneralError("Something went wrong. Please try again.");
        setStep("form");
      }
    });
  }

  function handleConfirmMatch() {
    if (!formValues) return;
    startTransition(async () => {
      try {
        const result = await saveOperatorSubmissionAction({
          formValues,
          match,
          matchConfirmed: true,
          turnstileToken,
        });
        if (result.turnstileFailed) {
          handleTurnstileFailure(result.error!);
          return;
        }
        if (result.error) {
          setGeneralError(result.error);
          return;
        }
        // Only "confirmed_auto" (no existing venue for this Google Place ID)
        // is actually instant/no-review. If a venue with this place ID
        // already exists — unclaimed ("pending_review") or claimed by
        // someone else ("double_claim") — the backend routes it for manual
        // review instead of auto-provisioning an account. Route those to
        // the same accurate "submitted" confirmation already shown for the
        // no-match/rejected paths, rather than the "confirmed" screen's
        // promise of an account setup email that won't actually be sent.
        setStep(result.routedStatus === "confirmed_auto" ? "confirmed" : "submitted");
      } catch {
        setGeneralError("Something went wrong. Please try again.");
      }
    });
  }

  function handleRejectMatch() {
    setGeneralError(null);
    setFieldErrors({});
    setTurnstileToken(null);
    setStep("reject-form");
  }

  function handleRejectSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formValues) return;
    const data = new FormData(e.currentTarget);
    const rejectionNotes  = (data.get("rejection_notes")  as string)?.trim() ?? "";
    const website         = (data.get("website")          as string)?.trim() ?? "";
    const additionalNotes = (data.get("additional_notes") as string)?.trim() ?? "";

    const errors: Record<string, string> = {};
    if (!rejectionNotes) errors.rejection_notes = "Please tell us what’s incorrect";
    if (!website)        errors.website = "Required — helps us verify your business and get you listed";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      try {
        const result = await saveOperatorSubmissionAction({
          formValues,
          match,
          matchConfirmed: false,
          rejectionNotes,
          website,
          additionalNotes: additionalNotes || undefined,
          turnstileToken,
        });
        if (result.turnstileFailed) {
          handleTurnstileFailure(result.error!);
          return;
        }
        if (result.error) {
          setGeneralError(result.error);
          return;
        }
        setStep("submitted");
      } catch {
        setGeneralError("Something went wrong. Please try again.");
      }
    });
  }

  function handleNoMatchContinue() {
    if (!formValues) return;
    startTransition(async () => {
      try {
        const result = await saveOperatorSubmissionAction({
          formValues,
          match: null,
          matchConfirmed: false,
          turnstileToken,
        });
        if (result.turnstileFailed) {
          handleTurnstileFailure(result.error!);
          return;
        }
        if (result.error) {
          setGeneralError(result.error);
          return;
        }
        setStep("submitted");
      } catch {
        setGeneralError("Something went wrong. Please try again.");
      }
    });
  }

  // ── Step: looking-up ───────────────────────────────────────────────────────
  if (step === "looking-up") {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center min-h-[280px]">
        <div className="w-12 h-12 rounded-full border-4 border-amber-100 border-t-amber-500 animate-spin mb-8" />
        <p className="text-[17px] font-semibold text-gray-900 mb-3">
          Checking Google business details…
        </p>
        <p className="text-[14px] text-gray-500 leading-relaxed max-w-[260px]">
          We&rsquo;ll try to find your listing automatically to save you time.
        </p>
      </div>
    );
  }

  // ── Step: match ────────────────────────────────────────────────────────────
  if (step === "match" && match) {
    const hasCoords = match.lat != null && match.lng != null;
    const addressLine1 = match.streetAddress;
    const addressLine2 = [
      [match.city, match.province].filter(Boolean).join(", "),
      match.postalCode ?? "",
    ]
      .filter(Boolean)
      .join("  ");

    return (
      <div className="px-5 pt-5 pb-8">
        <BackButton
          onClick={() => {
            setStep("form");
            setGeneralError(null);
          }}
        />

        <h3 className="text-[17px] font-bold text-gray-900 mb-5">
          Is this your business?
        </h3>

        {generalError && (
          <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
            {generalError}
          </div>
        )}

        <div className="rounded-xl border border-gray-200 overflow-hidden mb-6">
          {hasCoords && <ConfirmationMap lat={match.lat!} lng={match.lng!} />}
          <div className="p-5 space-y-4">
            <p className="text-[18px] font-bold text-gray-900 leading-snug">
              {match.name ?? formValues?.businessName}
            </p>
            <div className="flex gap-2.5">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 text-gray-400 shrink-0 mt-0.5"
                aria-hidden="true"
              >
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <div className="text-[14px] text-gray-600 leading-relaxed space-y-0.5">
                {addressLine1 && <p>{addressLine1}</p>}
                {addressLine2 && <p>{addressLine2}</p>}
              </div>
            </div>
            {match.phone && (
              <div className="flex gap-2.5 items-center">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4 text-gray-400 shrink-0"
                  aria-hidden="true"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.6 3.4 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <p className="text-[14px] text-gray-600">{match.phone}</p>
              </div>
            )}
          </div>
        </div>

        <div className="mb-5">
          <Turnstile
            ref={turnstileRef}
            onVerify={setTurnstileToken}
            onExpire={() => setTurnstileToken(null)}
          />
        </div>

        <div className="space-y-3">
          <button
            onClick={handleConfirmMatch}
            disabled={isPending || !turnstileToken}
            className={BTN_PRIMARY}
          >
            {isPending ? "Saving…" : "Yes, this is my business"}
          </button>
          <button
            onClick={handleRejectMatch}
            disabled={isPending}
            className={BTN_SECONDARY}
          >
            This is not my business
          </button>
        </div>
      </div>
    );
  }

  // ── Step: no-match ─────────────────────────────────────────────────────────
  if (step === "no-match") {
    return (
      <div className="px-5 pt-5 pb-8">
        <BackButton
          onClick={() => {
            setStep("form");
            setGeneralError(null);
            setTurnstileToken(null);
          }}
        />
        <div className="flex flex-col items-center text-center pt-4">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-6 text-2xl">
            🔍
          </div>
          <h3 className="text-[20px] font-bold text-gray-900 mb-3 leading-snug">
            We couldn&rsquo;t find your business
          </h3>
          <p className="text-[14px] text-gray-500 leading-relaxed max-w-[290px] mb-8">
            We weren&rsquo;t able to automatically match{" "}
            <span className="font-medium text-gray-700">
              {formValues?.businessName}
            </span>{" "}
            on Google. No worries&nbsp;&mdash; submit your details below and
            we&rsquo;ll review your business manually.
          </p>
          {generalError && (
            <div className="mb-5 w-full px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
              {generalError}
            </div>
          )}
          <div className="w-full mb-5">
            <Turnstile
              ref={turnstileRef}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken(null)}
            />
          </div>
          <button
            onClick={handleNoMatchContinue}
            disabled={isPending || !turnstileToken}
            className={BTN_PRIMARY}
          >
            {isPending ? "Submitting…" : "Submit my details"}
          </button>
        </div>
      </div>
    );
  }

  // ── Step: reject-form ──────────────────────────────────────────────────────
  if (step === "reject-form") {
    return (
      <div className="px-5 pt-5 pb-8">
        <BackButton
          onClick={() => {
            setStep("match");
            setFieldErrors({});
            setGeneralError(null);
            setTurnstileToken(null);
          }}
        />
        <h3 className="text-[17px] font-bold text-gray-900 mb-2">
          Let us know more
        </h3>
        <p className="text-[14px] text-gray-500 leading-relaxed mb-6">
          Help us find the right listing. We&rsquo;ll review your details and
          be in touch.
        </p>

        {generalError && (
          <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
            {generalError}
          </div>
        )}

        <form onSubmit={handleRejectSubmit} noValidate>
          <div className="space-y-5">
            <div>
              <label htmlFor="avm-rejection_notes" className={LABEL_CLASS}>
                What&rsquo;s incorrect? <span className="text-red-500">*</span>
              </label>
              <textarea
                id="avm-rejection_notes"
                name="rejection_notes"
                rows={3}
                placeholder="e.g. Wrong address, different business name, wrong city…"
                className={INPUT_CLASS + " resize-none"}
              />
              <FieldError msg={fieldErrors.rejection_notes} />
            </div>
            <div>
              <label htmlFor="avm-website" className={LABEL_CLASS}>
                Business website <span className="text-red-500">*</span>
              </label>
              <input
                id="avm-website"
                name="website"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://yourbusiness.com"
                className={INPUT_CLASS}
              />
              <FieldError msg={fieldErrors.website} />
            </div>
            <div>
              <label htmlFor="avm-additional_notes" className={LABEL_CLASS}>
                Anything else we should know?{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="avm-additional_notes"
                name="additional_notes"
                rows={2}
                className={INPUT_CLASS + " resize-none"}
              />
            </div>
          </div>
          <div className="mt-5">
            <Turnstile
              ref={turnstileRef}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken(null)}
            />
          </div>
          <button
            type="submit"
            disabled={isPending || !turnstileToken}
            className={"mt-5 " + BTN_PRIMARY}
          >
            {isPending ? "Sending…" : "Send my details"}
          </button>
        </form>
      </div>
    );
  }

  // ── Step: confirmed — Google business match confirmed, auto-provisioned ────
  if (step === "confirmed") {
    return (
      <div className="px-6 py-10 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-6">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#d97706"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-8 h-8"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3 className="text-[20px] font-bold text-gray-900 mb-4 leading-snug">
          Your venue is on Happy Hour Compass
        </h3>
        <p className="text-[15px] text-gray-600 leading-relaxed mb-6 max-w-[290px]">
          We matched your business automatically — no manual review needed.
        </p>
        <div className="mb-10">
          <EmailConfirmationNote lead="We&rsquo;ve sent you an account setup email." />
        </div>
        <button
          type="button"
          onClick={onDone}
          className="px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-[15px] transition-colors"
        >
          Continue Browsing
        </button>
      </div>
    );
  }

  // ── Step: submitted — no Google match, or match flagged wrong; manual review ─
  if (step === "submitted") {
    return (
      <div className="px-6 py-10 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-6">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#d97706"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-8 h-8"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h3 className="text-[20px] font-bold text-gray-900 mb-4 leading-snug">
          Thanks&nbsp;&mdash; we&rsquo;ve got your details
        </h3>
        <p className="text-[15px] text-gray-600 leading-relaxed mb-6 max-w-[290px]">
          We&rsquo;ll review your submission and get back to you within 2
          business days.
        </p>
        <div className="mb-10">
          <EmailConfirmationNote lead="We&rsquo;ve also sent a confirmation email to your inbox." />
        </div>
        <button
          type="button"
          onClick={onDone}
          className="px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-[15px] transition-colors"
        >
          Continue Browsing
        </button>
      </div>
    );
  }

  // ── Step: form (default) ───────────────────────────────────────────────────
  return (
    <form onSubmit={handleFormSubmit} className="px-5 pt-6 pb-12" noValidate>
      <div className="mb-5 px-4 py-3 bg-amber-50 border border-amber-100 rounded-lg">
        <p className="text-[13px] text-amber-900 leading-relaxed">
          This form is for venues that aren&rsquo;t listed on Happy Hour
          Compass yet. If your venue is already listed,{" "}
          <Link
            href="/claim-your-venue"
            className="font-semibold underline underline-offset-2 hover:text-amber-950"
          >
            claim it instead
          </Link>
          .
        </p>
      </div>

      <p className="text-[14px] text-gray-500 leading-relaxed mb-6">
        Enter your business details and we&rsquo;ll try to look you up on
        Google to save you time.
      </p>

      {generalError && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
          {generalError}
        </div>
      )}

      <div className="space-y-5">
        <p className="text-[12px] font-semibold text-gray-400 uppercase tracking-wide pt-1">
          Business details
        </p>

        <div>
          <label htmlFor="avm-business_name" className={LABEL_CLASS}>
            Business name <span className="text-red-500">*</span>
          </label>
          <input
            id="avm-business_name"
            name="business_name"
            type="text"
            autoComplete="organization"
            placeholder="e.g. The Keg Steakhouse"
            className={INPUT_CLASS}
          />
          <FieldError msg={fieldErrors.business_name} />
        </div>

        <div>
          <label htmlFor="avm-street_address" className={LABEL_CLASS}>
            Street address <span className="text-red-500">*</span>
          </label>
          <input
            id="avm-street_address"
            name="street_address"
            type="text"
            autoComplete="street-address"
            placeholder="e.g. 123 Main St"
            className={INPUT_CLASS}
          />
          <FieldError msg={fieldErrors.street_address} />
        </div>

        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <label htmlFor="avm-city" className={LABEL_CLASS}>
              City <span className="text-red-500">*</span>
            </label>
            <input
              id="avm-city"
              name="city"
              type="text"
              autoComplete="address-level2"
              placeholder="e.g. Vancouver"
              className={INPUT_CLASS}
            />
            <FieldError msg={fieldErrors.city} />
          </div>
          <div className="w-[120px] shrink-0">
            <label htmlFor="avm-province" className={LABEL_CLASS}>
              Province/State <span className="text-red-500">*</span>
            </label>
            <input
              id="avm-province"
              name="province"
              type="text"
              autoComplete="address-level1"
              placeholder="e.g. BC"
              className={INPUT_CLASS}
            />
            <FieldError msg={fieldErrors.province} />
          </div>
        </div>

        <div className="border-t border-gray-100 pt-1">
          <p className="text-[12px] font-semibold text-gray-400 uppercase tracking-wide">
            Your details
          </p>
        </div>

        <div className="flex gap-3">
          <div className="flex-1 min-w-0">
            <label htmlFor="avm-first_name" className={LABEL_CLASS}>
              First name <span className="text-red-500">*</span>
            </label>
            <input
              id="avm-first_name"
              name="first_name"
              type="text"
              autoComplete="given-name"
              placeholder="Jane"
              className={INPUT_CLASS}
            />
            <FieldError msg={fieldErrors.first_name} />
          </div>
          <div className="flex-1 min-w-0">
            <label htmlFor="avm-last_name" className={LABEL_CLASS}>
              Last name <span className="text-red-500">*</span>
            </label>
            <input
              id="avm-last_name"
              name="last_name"
              type="text"
              autoComplete="family-name"
              placeholder="Smith"
              className={INPUT_CLASS}
            />
            <FieldError msg={fieldErrors.last_name} />
          </div>
        </div>

        <div>
          <label htmlFor="avm-position" className={LABEL_CLASS}>
            Position <span className="text-red-500">*</span>
          </label>
          <select
            id="avm-position"
            name="position"
            defaultValue=""
            className={INPUT_CLASS}
          >
            <option value="" disabled>Select your position</option>
            <option value="Owner">Owner</option>
            <option value="Manager">Manager</option>
            <option value="Bartender">Bartender</option>
            <option value="Server">Server</option>
            <option value="Other">Other</option>
          </select>
          <FieldError msg={fieldErrors.position} />
        </div>

        <div>
          <label htmlFor="avm-email" className={LABEL_CLASS}>
            Email address <span className="text-red-500">*</span>
          </label>
          <input
            id="avm-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@yourbusiness.com"
            className={INPUT_CLASS}
          />
          <FieldError msg={fieldErrors.email} />
        </div>
      </div>

      <button type="submit" className={"mt-8 " + BTN_PRIMARY}>
        Find my business
      </button>

      <p className="mt-4 text-center text-[12px] text-gray-400 leading-relaxed">
        All fields required. We&rsquo;ll use your details to look up your
        business and get in touch. By continuing, you agree to our{" "}
        <a
          href="/terms"
          className="underline hover:text-gray-600 transition-colors"
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href="/privacy"
          className="underline hover:text-gray-600 transition-colors"
        >
          Privacy Policy
        </a>
        .
      </p>
    </form>
  );
}
