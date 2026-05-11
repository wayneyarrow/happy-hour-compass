"use client";

import { useActionState } from "react";
import { submitMoreInfoAction, type MoreInfoState } from "./actions";

const INPUT =
  "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "placeholder:text-gray-400 disabled:bg-gray-50 disabled:text-gray-500";

const LABEL = "block text-sm font-medium text-gray-700 mb-1.5";
const FIELD_ERROR = "mt-1.5 text-xs text-red-600";

type InitialValues = {
  venue_name: string;
  street_address: string;
  city: string;
  province: string;
  first_name: string;
  last_name: string;
  email: string;
  position: string;
};

export default function MoreInfoForm({
  token,
  initial,
}: {
  token: string;
  initial: InitialValues;
}) {
  // Bind token server-side — it never appears in FormData and cannot be
  // tampered with. The token IS the credential for this form.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundAction = (submitMoreInfoAction as any).bind(null, token);
  const [state, formAction, pending] = useActionState<MoreInfoState, FormData>(
    boundAction,
    {}
  );

  // ── Success state ─────────────────────────────────────────────────────────
  if (state.success) {
    return (
      <div className="px-5 pt-12 pb-16 flex flex-col items-center text-center">
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
        <p className="text-[14px] text-gray-500 leading-relaxed max-w-[280px]">
          We&rsquo;ve got what we need to verify <strong className="text-gray-700">{initial.venue_name}</strong>.
          We&rsquo;ll review your submission and be in touch soon.
        </p>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <form action={formAction} className="px-5 pt-6 pb-16">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">
          Happy Hour Compass
        </p>
        <h1 className="text-[20px] font-bold text-gray-900 leading-snug mb-2">
          A few more details needed
        </h1>
        <p className="text-[13px] text-gray-500 leading-relaxed">
          We weren&rsquo;t able to automatically verify your venue listing. Please provide a few extra
          details so we can review and create your operator account.
        </p>
      </div>

      {/* General error */}
      {state.error && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
          {state.error}
        </div>
      )}

      {/* ── Section 1: Confirm your business details ────────────────────────── */}
      <div className="mb-1">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Confirm business details
        </p>
        <div className="space-y-4">

          <div>
            <label htmlFor="venue_name" className={LABEL}>
              Business name <span className="text-red-500">*</span>
            </label>
            <input
              id="venue_name"
              name="venue_name"
              type="text"
              defaultValue={initial.venue_name}
              autoComplete="organization"
              className={INPUT}
            />
            {state.fieldErrors?.venue_name && (
              <p className={FIELD_ERROR}>{state.fieldErrors.venue_name}</p>
            )}
          </div>

          <div>
            <label htmlFor="street_address" className={LABEL}>
              Street address
            </label>
            <input
              id="street_address"
              name="street_address"
              type="text"
              defaultValue={initial.street_address}
              autoComplete="street-address"
              className={INPUT}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="city" className={LABEL}>
                City
              </label>
              <input
                id="city"
                name="city"
                type="text"
                defaultValue={initial.city}
                autoComplete="address-level2"
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="province" className={LABEL}>
                Province / state
              </label>
              <input
                id="province"
                name="province"
                type="text"
                defaultValue={initial.province}
                autoComplete="address-level1"
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label htmlFor="position" className={LABEL}>
              Your role at the venue <span className="text-red-500">*</span>
            </label>
            <input
              id="position"
              name="position"
              type="text"
              defaultValue={initial.position}
              placeholder="e.g. Owner, General Manager"
              className={INPUT}
            />
          </div>

          {/* Submitter identity — read-only context */}
          <div className="px-3 py-3 bg-gray-50 rounded-lg border border-gray-100">
            <p className="text-[11px] text-gray-400 mb-0.5">Submitting as</p>
            <p className="text-[13px] font-medium text-gray-700">
              {[initial.first_name, initial.last_name].filter(Boolean).join(" ") || "—"}
            </p>
            <p className="text-[12px] text-gray-500">{initial.email}</p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="my-6 border-t border-gray-100" />

      {/* ── Section 2: Verification details ────────────────────────────────── */}
      <div className="space-y-4">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Verification details
        </p>

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
            placeholder="e.g. (604) 555-0123"
            className={INPUT}
          />
          {state.fieldErrors?.info_phone && (
            <p className={FIELD_ERROR}>{state.fieldErrors.info_phone}</p>
          )}
        </div>

        <div>
          <label htmlFor="info_website" className={LABEL}>
            Website or social profile{" "}
            <span className="text-red-500">*</span>
            <span className="text-gray-400 font-normal ml-1">(at least one required)</span>
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
            Instagram{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
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
            Facebook{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
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
            TikTok{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="info_tiktok"
            name="info_tiktok"
            type="text"
            placeholder="https://tiktok.com/@yourvenue or @handle"
            className={INPUT}
          />
        </div>

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

        <div>
          <label htmlFor="info_additional_notes" className={LABEL}>
            Anything else we should know{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="info_additional_notes"
            name="info_additional_notes"
            rows={2}
            placeholder="Any additional context that might help us verify your listing."
            className={INPUT + " resize-none"}
          />
        </div>

        <div>
          <label htmlFor="info_preferred_contact" className={LABEL}>
            Preferred follow-up method{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="info_preferred_contact"
            name="info_preferred_contact"
            type="text"
            placeholder="e.g. email, phone, either"
            className={INPUT}
          />
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={pending}
        className="mt-8 w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-[15px] transition-colors"
      >
        {pending ? "Submitting…" : "Submit verification details"}
      </button>

      <p className="mt-4 text-center text-[12px] text-gray-400">
        This information is used to verify your venue ownership and is reviewed only by
        Happy Hour Compass staff.
      </p>
    </form>
  );
}
