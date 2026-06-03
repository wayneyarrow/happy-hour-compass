"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConsumerVenue } from "@/lib/data/venues";
import type { RailKey } from "@/lib/data/discoverOverridesShared";
import { EXCLUDE_REASON_TYPES } from "@/lib/data/discoverOverridesShared";
import {
  updateBoostAction,
  updateSpotlightEligibleAction,
  updateExcludeFromDiscoverAction,
  removeFromRailAction,
} from "./actions";

type Props = {
  venue: ConsumerVenue;
  railKey: RailKey;
  source: "algorithm" | "override";
  showSpotlightControl: boolean;
};

const PLAN_BADGE: Record<string, string> = {
  premium:    "bg-amber-100 text-amber-800",
  enterprise: "bg-purple-100 text-purple-800",
  pro:        "bg-blue-100 text-blue-800",
  free:       "bg-gray-100 text-gray-500",
};

export function DiscoverVenueRow({
  venue,
  railKey,
  source,
  showSpotlightControl,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Boost
  const [boost, setBoost] = useState(venue.internalBoost);
  const boostRef = useRef(venue.internalBoost);

  // Nix dialog
  const [nixOpen, setNixOpen] = useState(false);
  const [nixReason, setNixReason] = useState("");
  const [nixNote, setNixNote] = useState("");

  const refresh = () => router.refresh();

  const handleBoostBlur = () => {
    if (boost === boostRef.current) return;
    boostRef.current = boost;
    startTransition(async () => {
      await updateBoostAction(venue.venueUuid, boost);
      refresh();
    });
  };

  const handleSpotlightToggle = (checked: boolean) => {
    startTransition(async () => {
      await updateSpotlightEligibleAction(venue.venueUuid, checked);
      refresh();
    });
  };

  const handleExcludeToggle = (checked: boolean) => {
    startTransition(async () => {
      await updateExcludeFromDiscoverAction(venue.venueUuid, checked);
      refresh();
    });
  };

  const handleNixConfirm = () => {
    startTransition(async () => {
      const fd = new FormData();
      if (nixReason) fd.set("reason_type", nixReason);
      if (nixNote)   fd.set("note", nixNote);
      await removeFromRailAction(railKey, venue.venueUuid, null, fd);
      setNixOpen(false);
      refresh();
    });
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-gray-100 last:border-0 text-sm ${
        isPending ? "opacity-60" : ""
      }`}
    >
      {/* Name + type */}
      <div className="flex-1 min-w-0">
        <span className="font-medium text-slate-800 truncate block">{venue.name}</span>
        <span className="text-xs text-gray-400">{venue.establishmentType}</span>
      </div>

      {/* Plan badge */}
      <span
        className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
          PLAN_BADGE[venue.operatorPlan] ?? PLAN_BADGE.free
        }`}
      >
        {venue.operatorPlan}
      </span>

      {/* Source badge */}
      <span
        className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
          source === "override"
            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
            : "bg-gray-50 text-gray-500 border border-gray-200"
        }`}
      >
        {source === "override" ? "✚ Added" : "Algorithm"}
      </span>

      {/* Boost input */}
      <label className="shrink-0 flex items-center gap-1.5 text-xs text-gray-500">
        Boost
        <input
          type="number"
          min={0}
          max={100}
          value={boost}
          onChange={(e) => setBoost(Number(e.target.value))}
          onBlur={handleBoostBlur}
          className="w-14 px-2 py-1 border border-gray-300 rounded text-xs text-center focus:ring-1 focus:ring-amber-400 focus:outline-none"
        />
      </label>

      {/* Spotlight eligible toggle */}
      {showSpotlightControl && (
        <label className="shrink-0 flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            checked={venue.spotlightEligible}
            onChange={(e) => handleSpotlightToggle(e.target.checked)}
            className="rounded border-gray-300 text-amber-500 focus:ring-amber-400"
          />
          Spotlight
        </label>
      )}

      {/* Exclude from discover toggle */}
      <label className="shrink-0 flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
        <input
          type="checkbox"
          checked={venue.excludeFromDiscover}
          onChange={(e) => handleExcludeToggle(e.target.checked)}
          className="rounded border-gray-300 text-red-500 focus:ring-red-400"
        />
        Exclude all
      </label>

      {/* Nix button */}
      <button
        onClick={() => setNixOpen(true)}
        disabled={isPending}
        className="shrink-0 text-xs text-gray-400 hover:text-red-600 underline-offset-2 hover:underline transition-colors"
      >
        Nix from rail
      </button>

      {/* Nix dialog */}
      {nixOpen && (
        <div className="w-full mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs font-medium text-red-800 mb-2">
            Remove <strong>{venue.name}</strong> from this rail?
          </p>
          <div className="flex flex-wrap gap-2 mb-2">
            <select
              value={nixReason}
              onChange={(e) => setNixReason(e.target.value)}
              className="text-xs px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-amber-400 bg-white"
            >
              <option value="">Reason (optional)</option>
              {EXCLUDE_REASON_TYPES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Note (optional)"
              value={nixNote}
              onChange={(e) => setNixNote(e.target.value)}
              className="flex-1 min-w-32 text-xs px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-amber-400"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleNixConfirm}
              disabled={isPending}
              className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded font-medium transition-colors disabled:opacity-50"
            >
              Confirm remove
            </button>
            <button
              onClick={() => setNixOpen(false)}
              className="text-xs px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
