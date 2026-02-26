"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateBusinessDetailsAction } from "./actions";
import { type BusinessDetailsState } from "./types";

export type BusinessDetailsInitial = {
  name: string;
  address_line1: string;
  city: string;
  region: string;
  postal_code: string;
  phone: string;
  country: string;
  lat: string;
  lng: string;
};

type Props = {
  venueId: string;
  initialValues: BusinessDetailsInitial;
};

const initialState: BusinessDetailsState = {};

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-60";

const labelCls = "block text-sm font-medium text-gray-700 mb-1";

export default function BusinessDetailsForm({ venueId, initialValues }: Props) {
  const router = useRouter();
  const boundAction = updateBusinessDetailsAction.bind(null, venueId);
  const [state, formAction, isPending] = useActionState(
    boundAction,
    initialState
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state.success) {
      router.refresh();
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [state.success, router]);

  // On failed submit, restore user's last input; on first render, use DB values.
  const v = state.values ?? initialValues;

  return (
    <form action={formAction} className="space-y-5">
      {state.errors?.form && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {state.errors.form}
        </div>
      )}

      {/* Name */}
      <div>
        <label htmlFor="bd-name" className={labelCls}>
          Venue name{" "}
          <span className="text-red-500" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="bd-name"
          name="name"
          type="text"
          required
          disabled={isPending}
          defaultValue={v.name}
          placeholder="e.g. The Rusty Anchor"
          className={inputCls}
        />
        {state.errors?.name && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {state.errors.name}
          </p>
        )}
      </div>

      {/* Address */}
      <div>
        <label htmlFor="bd-address" className={labelCls}>
          Address
        </label>
        <input
          id="bd-address"
          name="address_line1"
          type="text"
          disabled={isPending}
          defaultValue={v.address_line1}
          placeholder="123 Main St"
          className={inputCls}
        />
      </div>

      {/* City + Region */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="bd-city" className={labelCls}>
            City
          </label>
          <input
            id="bd-city"
            name="city"
            type="text"
            disabled={isPending}
            defaultValue={v.city}
            placeholder="Kelowna"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="bd-region" className={labelCls}>
            Province / State
          </label>
          <input
            id="bd-region"
            name="region"
            type="text"
            disabled={isPending}
            defaultValue={v.region}
            placeholder="BC"
            className={inputCls}
          />
        </div>
      </div>

      {/* Postal + Country */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="bd-postal" className={labelCls}>
            Postal / ZIP code
          </label>
          <input
            id="bd-postal"
            name="postal_code"
            type="text"
            disabled={isPending}
            defaultValue={v.postal_code}
            placeholder="V1Y 6N6"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="bd-country" className={labelCls}>
            Country
          </label>
          <input
            id="bd-country"
            name="country"
            type="text"
            disabled={isPending}
            defaultValue={v.country}
            placeholder="Canada"
            className={inputCls}
          />
        </div>
      </div>

      {/* Phone */}
      <div>
        <label htmlFor="bd-phone" className={labelCls}>
          Phone{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="bd-phone"
          name="phone"
          type="tel"
          disabled={isPending}
          defaultValue={v.phone}
          placeholder="+1 250 555 0100"
          className={inputCls}
        />
      </div>

      {/* Lat / Lng */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="bd-lat" className={labelCls}>
            Latitude{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="bd-lat"
            name="lat"
            type="number"
            step="any"
            disabled={isPending}
            defaultValue={v.lat}
            placeholder="49.8880"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="bd-lng" className={labelCls}>
            Longitude{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="bd-lng"
            name="lng"
            type="number"
            step="any"
            disabled={isPending}
            defaultValue={v.lng}
            placeholder="-119.4960"
            className={inputCls}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save details"}
        </button>
        {saved && (
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-green-100 text-green-700"
            role="status"
          >
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
