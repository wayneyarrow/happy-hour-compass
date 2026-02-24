"use client";

import { useActionState } from "react";
import { createVenueAction, type CreateVenueState } from "./actions";
import Link from "next/link";

const initialState: CreateVenueState = {};

/** Shared input class to keep field styling consistent. */
const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-60";

export default function VenueForm() {
  const [state, formAction, isPending] = useActionState(
    createVenueAction,
    initialState
  );

  const v = state.values;

  return (
    <form action={formAction} className="space-y-5">
      {/* ── Form-level error ─────────────────────────────────────────────── */}
      {state.errors?.form && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {state.errors.form}
        </div>
      )}

      {/* ── Name (required) ──────────────────────────────────────────────── */}
      <div>
        <label
          htmlFor="name"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Venue name <span className="text-red-500" aria-hidden="true">*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          disabled={isPending}
          defaultValue={v?.name ?? ""}
          placeholder="e.g. The Rusty Anchor"
          className={inputCls}
        />
        {state.errors?.name && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {state.errors.name}
          </p>
        )}
      </div>

      {/* ── Address ──────────────────────────────────────────────────────── */}
      <div>
        <label
          htmlFor="address_line1"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Address
        </label>
        <input
          id="address_line1"
          name="address_line1"
          type="text"
          disabled={isPending}
          defaultValue={v?.address_line1 ?? ""}
          placeholder="123 Main St"
          className={inputCls}
        />
      </div>

      {/* ── City + Region ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="city"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            City
          </label>
          <input
            id="city"
            name="city"
            type="text"
            disabled={isPending}
            defaultValue={v?.city ?? ""}
            placeholder="Kelowna"
            className={inputCls}
          />
        </div>
        <div>
          <label
            htmlFor="region"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Province / State
          </label>
          <input
            id="region"
            name="region"
            type="text"
            disabled={isPending}
            defaultValue={v?.region ?? ""}
            placeholder="BC"
            className={inputCls}
          />
        </div>
      </div>

      {/* ── Postal code ──────────────────────────────────────────────────── */}
      <div>
        <label
          htmlFor="postal_code"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Postal / ZIP code
        </label>
        <input
          id="postal_code"
          name="postal_code"
          type="text"
          disabled={isPending}
          defaultValue={v?.postal_code ?? ""}
          placeholder="V1Y 6N6"
          className={inputCls}
        />
      </div>

      {/* ── Phone ────────────────────────────────────────────────────────── */}
      <div>
        <label
          htmlFor="phone"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Phone <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          disabled={isPending}
          defaultValue={v?.phone ?? ""}
          placeholder="+1 250 555 0100"
          className={inputCls}
        />
      </div>

      {/* ── Website ──────────────────────────────────────────────────────── */}
      <div>
        <label
          htmlFor="website_url"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Website URL <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="website_url"
          name="website_url"
          type="url"
          disabled={isPending}
          defaultValue={v?.website_url ?? ""}
          placeholder="https://example.com"
          className={inputCls}
        />
      </div>

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Creating…" : "Create venue"}
        </button>
        <Link
          href="/dashboard"
          className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
