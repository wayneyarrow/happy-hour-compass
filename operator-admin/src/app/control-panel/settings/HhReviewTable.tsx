"use client";

import { useState } from "react";
import HhTimesForm from "@/app/admin/happy-hours/HhTimesForm";
import { cpFixHhTimesAction } from "./actions";
import type { HhTimesState } from "@/app/admin/happy-hours/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReviewVenue = {
  id: string;
  name: string;
  city: string | null;
  hh_times: string | null;
};

// ── HhFixPanel ────────────────────────────────────────────────────────────────

/**
 * Right-side slide-in panel containing the structured HH times editor.
 * Reuses HhTimesForm (the same component operators use) with the CP-specific
 * action passed via actionOverride.
 */
function HhFixPanel({
  venue,
  boundAction,
  onClose,
  onSuccess,
}: {
  venue: ReviewVenue;
  boundAction: (prevState: HhTimesState, formData: FormData) => Promise<HhTimesState>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{venue.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {venue.city ?? <span className="italic">Unknown city</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-0.5 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close panel"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Raw hh_times reference */}
        {venue.hh_times && (
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 shrink-0">
            <p className="text-xs font-medium text-amber-700 mb-1">
              Raw hh_times (for reference only)
            </p>
            <p className="font-mono text-xs text-amber-600 break-all leading-relaxed">
              {venue.hh_times}
            </p>
          </div>
        )}

        {/* HH editor — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <HhTimesForm
            venueId={venue.id}
            initialHhTimes={venue.hh_times}
            actionOverride={boundAction}
            onSuccess={onSuccess}
          />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

// ── HhReviewTable ─────────────────────────────────────────────────────────────

/**
 * Client component that renders the HH Times Manual Review table.
 *
 * Each row has a "Fix" button that opens the HhFixPanel — a right-side panel
 * containing the existing structured HH editor. On Save, cpFixHhTimesAction:
 *   • updates hh_times
 *   • clears hh_times_needs_review = false
 *   • auto-publishes if the venue is imported + unpublished
 *
 * After a successful save the venue is removed from the local list instantly —
 * no full page reload required.
 */
export function HhReviewTable({ venues: initialVenues }: { venues: ReviewVenue[] }) {
  const [venues, setVenues] = useState<ReviewVenue[]>(initialVenues);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedVenue = venues.find((v) => v.id === selectedId) ?? null;

  // Bind the CP action to the selected venue's id. The panel mounts fresh each
  // time a venue is selected, so this reference is stable for the panel lifetime.
  const boundAction = selectedId
    ? (cpFixHhTimesAction.bind(null, selectedId) as (
        prevState: HhTimesState,
        formData: FormData
      ) => Promise<HhTimesState>)
    : null;

  function handleClose() {
    setSelectedId(null);
  }

  function handleSuccess() {
    // Remove the fixed venue from local state so the list updates immediately.
    setVenues((prev) => prev.filter((v) => v.id !== selectedId));
    setSelectedId(null);
  }

  return (
    <>
      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-left">
              <th className="px-4 py-2.5 font-medium text-gray-700">Venue</th>
              <th className="px-4 py-2.5 font-medium text-gray-700 w-28">City</th>
              <th className="px-4 py-2.5 font-medium text-gray-700">
                hh_times{" "}
                <span className="font-normal text-gray-400">(raw)</span>
              </th>
              <th className="px-4 py-2.5 w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {venues.map((v) => (
              <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 align-top font-medium text-slate-800">
                  {v.name}
                </td>
                <td className="px-4 py-3 align-top text-gray-500">
                  {v.city ?? <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 align-top">
                  {v.hh_times ? (
                    <span
                      className="font-mono text-xs text-gray-500 break-all"
                      title={v.hh_times}
                    >
                      {v.hh_times.length > 90
                        ? v.hh_times.slice(0, 90) + "…"
                        : v.hh_times}
                    </span>
                  ) : (
                    <span className="text-gray-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-right">
                  <button
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    className="px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
                  >
                    Fix
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedVenue && boundAction && (
        <HhFixPanel
          venue={selectedVenue}
          boundAction={boundAction}
          onClose={handleClose}
          onSuccess={handleSuccess}
        />
      )}
    </>
  );
}
