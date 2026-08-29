"use client";

import { useRef } from "react";
import { selectActiveVenueAction } from "./select-venue/actions";
import type { VenueRow } from "@/lib/getOperatorVenues";

/**
 * Persistent venue switcher shown in the Admin header for operators who
 * manage more than one venue. Posts to the same server action used by the
 * venue-selection screen (selectActiveVenueAction) — ownership is
 * re-validated server-side there, never trusted from this dropdown alone.
 *
 * Renders nothing (not even a placeholder) when impersonating, when the
 * operator owns 0-1 venues, or before a venue has been selected yet — the
 * last case shouldn't normally reach the header at all, since
 * assertActiveVenueSelected() redirects to /admin/select-venue first.
 */
export default function VenueSwitcher({
  isImpersonating,
  venues,
  activeVenueId,
}: {
  isImpersonating: boolean;
  venues: VenueRow[];
  activeVenueId: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  if (isImpersonating || venues.length <= 1 || !activeVenueId) {
    return null;
  }

  return (
    <form ref={formRef} action={selectActiveVenueAction}>
      <label htmlFor="venue-switcher" className="sr-only">
        Switch venue
      </label>
      <select
        id="venue-switcher"
        name="venueId"
        defaultValue={activeVenueId}
        onChange={() => formRef.current?.requestSubmit()}
        className="text-sm text-gray-700 border border-gray-200 rounded-md px-2 py-1.5 bg-white hover:border-gray-400 transition-colors max-w-[160px] sm:max-w-[200px] truncate"
      >
        {venues.map((venue) => (
          <option key={venue.id} value={venue.id}>
            {venue.name}
          </option>
        ))}
      </select>
    </form>
  );
}
