"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  searchVenueGooglePlaceAction,
  confirmVenueGooglePlaceAction,
  markVenueGoogleIdentityExemptAction,
  clearVenueGoogleIdentityExemptionAction,
  type GoogleSearchState,
  type VenueActionResult,
} from "./actions";

type Props = {
  venueId: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  placeId: string | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  googleIdentityStatus: "matched" | "unmatched" | "exempt";
  googleIdentityReason: string | null;
};

const INITIAL_SEARCH_STATE: GoogleSearchState = {};
const INITIAL_VENUE_ACTION_STATE: VenueActionResult = { success: false, error: "" };

const STATUS_BADGE: Record<Props["googleIdentityStatus"], string> = {
  matched:   "bg-green-100 text-green-700 border border-green-300",
  unmatched: "bg-gray-100 text-gray-600 border border-gray-300",
  exempt:    "bg-amber-100 text-amber-700 border border-amber-300",
};

const STATUS_LABEL: Record<Props["googleIdentityStatus"], string> = {
  matched:   "Matched",
  unmatched: "Unmatched",
  exempt:    "Exempt — no independent listing",
};

export default function GoogleIdentityPanel({
  venueId,
  name,
  addressLine1,
  city,
  region,
  placeId,
  googleRating,
  googleReviewCount,
  googleIdentityStatus,
  googleIdentityReason,
}: Props) {
  const router = useRouter();
  const [showSearch, setShowSearch] = useState(false);
  const [showExemptForm, setShowExemptForm] = useState(false);

  // ── Controlled search-form fields ───────────────────────────────────────
  //
  // Local state, seeded once from the venue's current props — deliberately
  // NOT re-derived from props on every render. This is what lets a
  // founder's manual correction (e.g. province "Yes" -> "BC") survive the
  // search action's state update instead of reverting back to the stale
  // persisted value.
  //
  // Why this was broken before: React 19 automatically resets UNCONTROLLED
  // form fields (`defaultValue`, no `value`/`onChange`) back to their
  // original defaultValue once any form-action dispatch on that
  // form completes — by design, so a form "clears" after a normal
  // submission. Controlled fields (`value` + `onChange`) are exempt from
  // that reset entirely, which is the documented way to opt out of it. See
  // the SpearHead Winery investigation for the original repro.
  const [searchName, setSearchName] = useState(name);
  const [searchStreetAddress, setSearchStreetAddress] = useState(addressLine1 ?? "");
  const [searchCity, setSearchCity] = useState(city ?? "");
  const [searchProvince, setSearchProvince] = useState(region ?? "");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundSearch = (searchVenueGooglePlaceAction as any).bind(null, venueId);
  const [searchState, searchFormAction, searchPending] =
    useActionState<GoogleSearchState, FormData>(boundSearch, INITIAL_SEARCH_STATE);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundConfirm = (confirmVenueGooglePlaceAction as any).bind(null, venueId);
  const [confirmState, confirmFormAction, confirmPending] =
    useActionState<VenueActionResult, FormData>(boundConfirm, INITIAL_VENUE_ACTION_STATE);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundExempt = (markVenueGoogleIdentityExemptAction as any).bind(null, venueId);
  const [exemptState, exemptFormAction, exemptPending] =
    useActionState<VenueActionResult, FormData>(boundExempt, INITIAL_VENUE_ACTION_STATE);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundClear = (clearVenueGoogleIdentityExemptionAction as any).bind(null, venueId);
  const [clearState, clearFormAction, clearPending] =
    useActionState<VenueActionResult, FormData>(boundClear, INITIAL_VENUE_ACTION_STATE);

  const isAnyPending = searchPending || confirmPending || exemptPending || clearPending;

  // Refresh the server-rendered venue data once after each successful
  // persist action — guarded so repeated renders of the same success state
  // don't re-trigger router.refresh() (matches SubmissionReviewPanel's
  // established pattern for this exact case).
  const didRefreshConfirm = useRef(false);
  useEffect(() => {
    if (confirmState.success && !didRefreshConfirm.current) {
      didRefreshConfirm.current = true;
      router.refresh();
    }
    if (!confirmState.success) didRefreshConfirm.current = false;
  }, [confirmState.success, router]);

  const didRefreshExempt = useRef(false);
  useEffect(() => {
    if (exemptState.success && !didRefreshExempt.current) {
      didRefreshExempt.current = true;
      router.refresh();
    }
    if (!exemptState.success) didRefreshExempt.current = false;
  }, [exemptState.success, router]);

  const didRefreshClear = useRef(false);
  useEffect(() => {
    if (clearState.success && !didRefreshClear.current) {
      didRefreshClear.current = true;
      router.refresh();
    }
    if (!clearState.success) didRefreshClear.current = false;
  }, [clearState.success, router]);

  const mapsUrl = placeId
    ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`
    : null;

  /** Closes the search panel and resets any unsaved edits back to the venue's current values. */
  function closeSearch() {
    setShowSearch(false);
    setSearchName(name);
    setSearchStreetAddress(addressLine1 ?? "");
    setSearchCity(city ?? "");
    setSearchProvince(region ?? "");
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Google Identity
        </h2>
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[googleIdentityStatus]}`}>
          {STATUS_LABEL[googleIdentityStatus]}
        </span>
      </div>

      {/* ── Matched summary ─────────────────────────────────────────────── */}
      {googleIdentityStatus === "matched" && (
        <dl className="space-y-2 text-sm mb-4">
          <div className="flex gap-3">
            <dt className="text-gray-400 w-28 shrink-0">Place ID</dt>
            <dd className="font-mono text-xs text-gray-700 break-all">{placeId}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-gray-400 w-28 shrink-0">Rating</dt>
            <dd className="text-gray-800">
              {googleRating != null ? (
                <>★ {googleRating.toFixed(1)} ({googleReviewCount ?? 0} reviews)</>
              ) : (
                <span className="text-gray-400 italic">Not available</span>
              )}
            </dd>
          </div>
          {mapsUrl && (
            <div className="flex gap-3">
              <dt className="text-gray-400 w-28 shrink-0">Google Maps</dt>
              <dd>
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-amber-700 hover:underline">
                  Open listing ↗
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}

      {/* ── Exempt summary ──────────────────────────────────────────────── */}
      {googleIdentityStatus === "exempt" && (
        <div className="mb-4">
          <p className="text-sm text-gray-600">
            Marked as a legitimate exception — this venue has no independent Google listing of its own.
          </p>
          {googleIdentityReason && (
            <p className="text-sm text-gray-500 mt-1 italic">&ldquo;{googleIdentityReason}&rdquo;</p>
          )}
        </div>
      )}

      {/* ── Unmatched summary ───────────────────────────────────────────── */}
      {googleIdentityStatus === "unmatched" && (
        <p className="text-sm text-gray-500 mb-4">
          No Google identity attached yet. Search Google Places below, or mark this venue as a
          legitimate exception if it has no independent listing of its own (e.g. a lounge inside a hotel).
        </p>
      )}

      {/* ── Action banners ──────────────────────────────────────────────── */}
      {"error" in confirmState && confirmState.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {confirmState.error}
        </div>
      )}
      {"error" in exemptState && exemptState.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {exemptState.error}
        </div>
      )}
      {"error" in clearState && clearState.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {clearState.error}
        </div>
      )}

      {/* ── Clear exemption ─────────────────────────────────────────────── */}
      {googleIdentityStatus === "exempt" && (
        <form action={clearFormAction}>
          <button
            type="submit"
            disabled={isAnyPending}
            className="text-sm px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {clearPending ? "Clearing…" : "Clear exemption"}
          </button>
          <p className="text-xs text-gray-400 mt-2">
            Makes this venue eligible for automatic reconciliation and manual search again.
          </p>
        </form>
      )}

      {/* ── Search / confirm / exempt controls (matched can re-search; exempt must clear first) ── */}
      {googleIdentityStatus !== "exempt" && (
        <>
          {!showSearch ? (
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              disabled={isAnyPending}
              className="text-sm px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              {googleIdentityStatus === "matched" ? "Search a different listing" : "Search Google Places"}
            </button>
          ) : (
            // Fragment, not a shared wrapping element: the search form and
            // the candidate-result card below are SIBLINGS, each with their
            // own top-level form element. They used to be nested (the confirm form
            // lived inside the search form) — invalid HTML that made React
            // throw "A React form was unexpectedly submitted" and silently
            // prevented confirmVenueGooglePlaceAction from ever running.
            <>
              <form action={searchFormAction} className="space-y-3 border-t border-gray-100 pt-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Business name</label>
                  <input
                    type="text"
                    name="name"
                    value={searchName}
                    onChange={(e) => setSearchName(e.target.value)}
                    required
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Street address</label>
                  <input
                    type="text"
                    name="street_address"
                    value={searchStreetAddress}
                    onChange={(e) => setSearchStreetAddress(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">City</label>
                    <input
                      type="text"
                      name="city"
                      value={searchCity}
                      onChange={(e) => setSearchCity(e.target.value)}
                      required
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Province</label>
                    <input
                      type="text"
                      name="province"
                      value={searchProvince}
                      onChange={(e) => setSearchProvince(e.target.value)}
                      required
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={isAnyPending}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg disabled:opacity-40"
                  >
                    {searchPending ? "Searching…" : "Search Google Places"}
                  </button>
                  <button
                    type="button"
                    onClick={closeSearch}
                    className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                </div>

                {searchState.error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {searchState.error}
                  </div>
                )}
              </form>

              {searchState.candidate && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2 mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">{searchState.candidate.name}</span>
                    {searchState.confident ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                        Passes confidence checks
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                        ⚠ Does not pass — review carefully
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{searchState.candidate.formattedAddress}</p>
                  <p className="text-xs text-gray-500">
                    {searchState.candidate.rating != null
                      ? `★ ${searchState.candidate.rating.toFixed(1)} (${searchState.candidate.reviewCount ?? 0} reviews)`
                      : "No rating available"}
                  </p>
                  <p className="text-xs font-mono text-gray-400 break-all">{searchState.candidate.placeId}</p>

                  <form action={confirmFormAction}>
                    <input type="hidden" name="place_id" value={searchState.candidate.placeId} />
                    <button
                      type="submit"
                      disabled={isAnyPending}
                      className="mt-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg disabled:opacity-40"
                    >
                      {confirmPending ? "Confirming…" : "Confirm this listing"}
                    </button>
                  </form>
                  <p className="text-xs text-gray-400">
                    Confirming re-verifies this listing directly with Google before saving — nothing
                    is attached automatically without this explicit confirmation.
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── Mark as exempt ────────────────────────────────────────────── */}
          {googleIdentityStatus !== "matched" && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              {!showExemptForm ? (
                <button
                  type="button"
                  onClick={() => setShowExemptForm(true)}
                  disabled={isAnyPending}
                  className="text-sm text-gray-500 hover:text-gray-800 underline disabled:opacity-40"
                >
                  Mark as legitimate exception (no independent Google listing)
                </button>
              ) : (
                <form action={exemptFormAction} className="space-y-2">
                  <label className="block text-xs text-gray-500">Reason (optional but recommended)</label>
                  <textarea
                    name="reason"
                    rows={2}
                    placeholder='e.g. "Lounge inside Hyatt Place Kelowna — hotel has the Google listing instead."'
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={isAnyPending}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg disabled:opacity-40"
                    >
                      {exemptPending ? "Saving…" : "Mark as exempt"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowExemptForm(false)}
                      className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
