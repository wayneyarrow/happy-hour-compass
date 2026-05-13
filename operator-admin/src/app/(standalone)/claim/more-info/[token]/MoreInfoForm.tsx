"use client";

import { useActionState, useState } from "react";
import { submitClaimMoreInfoAction, type ClaimMoreInfoState } from "./actions";

const INPUT =
  "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "placeholder:text-gray-400 disabled:bg-gray-50 disabled:text-gray-500";

const LABEL = "block text-sm font-medium text-gray-700 mb-1.5";
const FIELD_ERROR = "mt-1.5 text-xs text-red-600";

// ── Phone formatting ──────────────────────────────────────────────────────────

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type InitialValues = {
  venue_name: string;
  first_name: string;
  last_name: string;
  email: string;
  position: string;
  initial_phone: string;
};

const CONTACT_OPTIONS = [
  { value: "Email",                    label: "Email" },
  { value: "Phone",                    label: "Phone" },
  { value: "Website / social profile", label: "Website / social profile" },
  { value: "Other",                    label: "Other" },
] as const;

// ── Form ──────────────────────────────────────────────────────────────────────

export default function MoreInfoForm({
  token,
  initial,
}: {
  token: string;
  initial: InitialValues;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundAction = (submitClaimMoreInfoAction as any).bind(null, token);
  const [state, formAction, pending] = useActionState<ClaimMoreInfoState, FormData>(
    boundAction,
    {}
  );

  const [phoneDisplay, setPhoneDisplay] = useState(() => formatPhone(initial.initial_phone));
  const [contactMethod, setContactMethod] = useState<string>("");

  // ── Success ───────────────────────────────────────────────────────────────
  if (state.success) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-8 py-12 flex flex-col items-center text-center">
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
        <h2 className="text-[20px] font-bold text-gray-900 mb-3 leading-snug">
          Details received — thank you!
        </h2>
        <p className="text-[14px] text-gray-500 leading-relaxed max-w-[300px]">
          We&rsquo;ve got what we need to verify your claim for{" "}
          <strong className="text-gray-700">{initial.venue_name}</strong>.
          We&rsquo;ll review your details and be in touch soon.
        </p>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="px-8 pt-8 pb-6 border-b border-gray-100">
        <h1 className="text-[20px] font-bold text-gray-900 leading-snug mb-2">
          A few more details needed
        </h1>
        <p className="text-[13px] text-gray-500 leading-relaxed">
          We need a bit more information to verify your claim for{" "}
          <strong className="text-gray-700">{initial.venue_name}</strong>.
          Please fill in the details below so we can complete your review.
        </p>
      </div>

      <form action={formAction} className="px-8 pt-6 pb-8 space-y-6">
        {/* General error */}
        {state.error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
            {state.error}
          </div>
        )}

        {/* Claimant identity — read-only context */}
        <div className="px-3 py-3 bg-gray-50 rounded-lg border border-gray-100">
          <p className="text-[11px] text-gray-400 mb-0.5">Submitting claim as</p>
          <p className="text-[13px] font-medium text-gray-700">
            {[initial.first_name, initial.last_name].filter(Boolean).join(" ") || "—"}
            {initial.position ? (
              <span className="text-gray-400 font-normal"> · {initial.position}</span>
            ) : null}
          </p>
          <p className="text-[12px] text-gray-500">{initial.email}</p>
        </div>

        <div className="border-t border-gray-100" />

        {/* ── Verification details ──────────────────────────────────────── */}
        <div className="space-y-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            Verification details
          </p>

          {/* Business phone */}
          <div>
            <label htmlFor="info_phone" className={LABEL}>
              Business phone number <span className="text-red-500">*</span>
            </label>
            <input
              id="info_phone"
              name="info_phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(250) 555-1234"
              value={phoneDisplay}
              onChange={(e) => setPhoneDisplay(formatPhone(e.target.value))}
              className={INPUT}
            />
            {state.fieldErrors?.info_phone && (
              <p className={FIELD_ERROR}>{state.fieldErrors.info_phone}</p>
            )}
          </div>

          {/* Website */}
          <div>
            <label htmlFor="info_website" className={LABEL}>
              Website{" "}
              <span className="text-red-500">*</span>
              <span className="text-gray-400 font-normal ml-1">(or at least one social profile)</span>
            </label>
            <input
              id="info_website"
              name="info_website"
              type="url"
              inputMode="url"
              placeholder="https://yourvenue.com"
              className={INPUT}
            />
            {state.fieldErrors?.info_website && (
              <p className={FIELD_ERROR}>{state.fieldErrors.info_website}</p>
            )}
          </div>

          <div>
            <label htmlFor="info_instagram" className={LABEL}>
              Instagram <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="info_instagram"
              name="info_instagram"
              type="text"
              placeholder="https://instagram.com/yourvenue or @handle"
              className={INPUT}
            />
          </div>

          <div>
            <label htmlFor="info_facebook" className={LABEL}>
              Facebook <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="info_facebook"
              name="info_facebook"
              type="text"
              placeholder="https://facebook.com/yourvenue"
              className={INPUT}
            />
          </div>

          <div>
            <label htmlFor="info_tiktok" className={LABEL}>
              TikTok <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              id="info_tiktok"
              name="info_tiktok"
              type="text"
              placeholder="https://tiktok.com/@yourvenue or @handle"
              className={INPUT}
            />
          </div>

          {/* Relationship to business */}
          <div>
            <label htmlFor="info_relationship" className={LABEL}>
              Your relationship to this business <span className="text-red-500">*</span>
            </label>
            <textarea
              id="info_relationship"
              name="info_relationship"
              rows={3}
              placeholder="e.g. I've owned and operated The Keg on Burrard since 2018. I can provide a copy of our business license on request."
              className={INPUT + " resize-none"}
            />
            {state.fieldErrors?.info_relationship && (
              <p className={FIELD_ERROR}>{state.fieldErrors.info_relationship}</p>
            )}
          </div>

          {/* Additional notes */}
          <div>
            <label htmlFor="info_additional_notes" className={LABEL}>
              Anything else we should know{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="info_additional_notes"
              name="info_additional_notes"
              rows={2}
              placeholder="Any additional context that might help us verify your claim."
              className={INPUT + " resize-none"}
            />
          </div>

          {/* Preferred contact */}
          <div>
            <p className={LABEL}>
              Preferred follow-up method{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </p>
            <div className="space-y-2">
              {CONTACT_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="info_preferred_contact"
                    value={opt.value}
                    checked={contactMethod === opt.value}
                    onChange={() => setContactMethod(opt.value)}
                    className="w-4 h-4 text-amber-500 border-gray-300 focus:ring-amber-400"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
            {contactMethod === "Other" && (
              <input
                name="info_preferred_contact_other"
                type="text"
                placeholder="Please describe…"
                className={INPUT + " mt-2.5"}
              />
            )}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={pending}
          className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-[15px] transition-colors"
        >
          {pending ? "Submitting…" : "Submit verification details"}
        </button>

        <p className="text-center text-[12px] text-gray-400">
          This information is used to verify your venue claim and is reviewed only by
          Happy Hour Compass staff.
        </p>
      </form>
    </div>
  );
}
