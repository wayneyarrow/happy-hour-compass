"use client";

import { useState, useActionState, useEffect } from "react";
import { submitClaimAction, type ClaimFormState } from "@/app/(consumer)/venue/[id]/claim/actions";
import { trackEvent } from "@/lib/analytics";

type Props = {
  venueRouteParam: string;
  venueName: string;
  onDone: () => void;
};

function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const ROLE_OPTIONS = ["Owner", "Manager", "Bartender", "Server", "Other"];

const INPUT_CLASS =
  "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "placeholder:text-gray-400";
const LABEL_CLASS = "block text-sm font-medium text-gray-700 mb-1.5";
const FIELD_ERROR_CLASS = "mt-1.5 text-xs text-red-600";

/**
 * Claim a Venue form adapted for the AcquisitionModal context.
 *
 * Reuses submitClaimAction (unchanged), all field names, all server-side
 * validation, and the complete claim flow. Only the success CTA differs:
 * instead of navigating away, it calls onDone() to close the modal and
 * return the user to exactly where they were on the Venue Detail page.
 */
export function ClaimVenueModalContent({ venueRouteParam, venueName, onDone }: Props) {
  const boundAction = submitClaimAction.bind(null, venueRouteParam);
  const [state, formAction, isPending] = useActionState<ClaimFormState, FormData>(
    boundAction,
    {}
  );
  const [phoneValue, setPhoneValue] = useState("");

  useEffect(() => {
    trackEvent("claim_venue_started");
  }, []);

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

        <h3 className="text-[20px] font-bold text-gray-900 mb-3 leading-snug">
          Thanks for your request.
        </h3>
        <p className="text-[15px] text-gray-600 leading-relaxed mb-2 max-w-[280px]">
          We just need to verify that you&rsquo;re associated with this venue
          before granting access.
        </p>
        <p className="text-[15px] text-gray-600 leading-relaxed mb-10">
          This usually takes less than 24 hours.
        </p>

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

  // ── Claim form ────────────────────────────────────────────────────────────
  return (
    <form action={formAction} className="px-6 pt-5 pb-8">
      {state.error && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-700">
          {state.error}
        </div>
      )}

      {/* Venue confirmation chip */}
      <div className="mb-6 px-4 py-3 bg-blue-50 border border-blue-100 rounded-lg">
        <p className="text-[13px] text-blue-700 leading-snug">
          Claiming: <span className="font-semibold">{venueName}</span>
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <label htmlFor="cvm-first_name" className={LABEL_CLASS}>
            First name <span className="text-red-500">*</span>
          </label>
          <input
            id="cvm-first_name"
            name="first_name"
            type="text"
            autoComplete="given-name"
            required
            className={INPUT_CLASS}
          />
          {state.fieldErrors?.first_name && (
            <p className={FIELD_ERROR_CLASS}>{state.fieldErrors.first_name}</p>
          )}
        </div>

        <div>
          <label htmlFor="cvm-last_name" className={LABEL_CLASS}>
            Last name <span className="text-red-500">*</span>
          </label>
          <input
            id="cvm-last_name"
            name="last_name"
            type="text"
            autoComplete="family-name"
            required
            className={INPUT_CLASS}
          />
          {state.fieldErrors?.last_name && (
            <p className={FIELD_ERROR_CLASS}>{state.fieldErrors.last_name}</p>
          )}
        </div>

        <div>
          <label htmlFor="cvm-position" className={LABEL_CLASS}>
            Your role at this venue <span className="text-red-500">*</span>
          </label>
          <select
            id="cvm-position"
            name="position"
            required
            defaultValue=""
            className={
              INPUT_CLASS +
              " appearance-none bg-white bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")] bg-no-repeat bg-[right_12px_center] pr-9"
            }
          >
            <option value="" disabled>
              Select your role
            </option>
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {state.fieldErrors?.position && (
            <p className={FIELD_ERROR_CLASS}>{state.fieldErrors.position}</p>
          )}
        </div>

        <div>
          <label htmlFor="cvm-phone" className={LABEL_CLASS}>
            Phone number <span className="text-red-500">*</span>
          </label>
          <input
            id="cvm-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(250) 555-1234"
            required
            value={phoneValue}
            onChange={(e) => setPhoneValue(formatPhoneInput(e.target.value))}
            className={INPUT_CLASS}
          />
          {state.fieldErrors?.phone && (
            <p className={FIELD_ERROR_CLASS}>{state.fieldErrors.phone}</p>
          )}
        </div>

        <div>
          <label htmlFor="cvm-email" className={LABEL_CLASS}>
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="cvm-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={INPUT_CLASS}
          />
          {state.fieldErrors?.email && (
            <p className={FIELD_ERROR_CLASS}>{state.fieldErrors.email}</p>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="mt-8 w-full py-3.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl text-[15px] transition-colors"
      >
        {isPending ? "Submitting…" : "Submit claim"}
      </button>

      <p className="mt-4 text-center text-[12px] text-gray-400 leading-relaxed">
        By submitting this claim, you agree to our{" "}
        <a href="/terms" className="underline hover:text-gray-600 transition-colors">
          Terms of Service
        </a>{" "}
        and{" "}
        <a href="/privacy" className="underline hover:text-gray-600 transition-colors">
          Privacy Policy
        </a>
        . Your information is used only to verify your association with this venue.
      </p>
    </form>
  );
}
