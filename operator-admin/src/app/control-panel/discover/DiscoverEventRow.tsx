"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CPFeaturedEventItem } from "@/lib/data/events";
import type { RailKey } from "@/lib/data/discoverOverridesShared";
import { EXCLUDE_REASON_TYPES } from "@/lib/data/discoverOverridesShared";
import {
  updateEventBoostAction,
  updateEventExcludeFromDiscoverAction,
  removeEventFromRailAction,
} from "./actions";

// ── Column widths — must match the header in discover/page.tsx (Featured Events) ──
// Event: flex-1 | Venue: w-28 | Plan: w-16 | Source: w-20 | Boost: w-16 | Excl.: w-24 | Nix: w-20
// ──────────────────────────────────────────────────────────────────────────────

type Props = {
  event: CPFeaturedEventItem;
  railKey: RailKey;
  source: "algorithm" | "override";
};

const PLAN_BADGE: Record<string, string> = {
  enterprise: "bg-purple-100 text-purple-700 border border-purple-300",
  premium:    "bg-amber-100  text-amber-700  border border-amber-300",
  pro:        "bg-sky-100    text-sky-700    border border-sky-300",
  free:       "bg-gray-100   text-gray-500   border border-gray-300",
};

export function DiscoverEventRow({ event, railKey, source }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Boost
  const [boost, setBoost] = useState(event.internalBoost);
  const boostRef = useRef(event.internalBoost);

  // Tracks which specific action is in flight
  const [excludeAction, setExcludeAction] = useState<"excluding" | "restoring" | null>(null);

  // Nix dialog
  const [nixOpen, setNixOpen] = useState(false);
  const [nixReason, setNixReason] = useState("");
  const [nixNote, setNixNote] = useState("");

  const refresh = () => router.refresh();

  const handleBoostBlur = () => {
    if (boost === boostRef.current) return;
    boostRef.current = boost;
    startTransition(async () => {
      await updateEventBoostAction(event.eventUuid, boost);
      refresh();
    });
  };

  const handleExcludeToggle = (checked: boolean) => {
    setExcludeAction(checked ? "excluding" : "restoring");
    startTransition(async () => {
      await updateEventExcludeFromDiscoverAction(event.eventUuid, checked);
      setExcludeAction(null);
      refresh();
    });
  };

  const handleNixConfirm = () => {
    startTransition(async () => {
      const fd = new FormData();
      if (nixReason) fd.set("reason_type", nixReason);
      if (nixNote)   fd.set("note", nixNote);
      await removeEventFromRailAction(railKey, event.eventUuid, null, fd);
      setNixOpen(false);
      refresh();
    });
  };

  return (
    <div
      className={`border-b border-gray-100 last:border-0 text-sm transition-opacity ${
        isPending && !excludeAction ? "opacity-60" : ""
      }`}
    >
      {/* ── Main row ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-4 py-3">

        {/* Event title + schedule — flex-1 */}
        <div className="flex-1 min-w-0">
          <span className="font-medium text-slate-800 truncate block">
            {event.title}
          </span>
          <span className="text-xs text-gray-400 truncate block">
            {event.nextOccurrenceLabel}
          </span>
        </div>

        {/* Venue name — w-28; links to CP venue detail */}
        <div className="shrink-0 w-28 min-w-0">
          <Link
            href={`/control-panel/venues/${event.venueUuid}`}
            className="text-xs text-slate-600 hover:text-amber-700 hover:underline underline-offset-2 truncate block transition-colors"
          >
            {event.venueName}
          </Link>
        </div>

        {/* Plan badge — w-16 */}
        <div className="shrink-0 w-16 flex justify-center">
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
              PLAN_BADGE[event.operatorPlan] ?? PLAN_BADGE.free
            }`}
          >
            {event.operatorPlan}
          </span>
        </div>

        {/* Source badge — w-20 */}
        <div className="shrink-0 w-20 flex justify-center">
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              source === "override"
                ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                : "bg-slate-100 text-slate-600 border border-slate-300"
            }`}
          >
            {source === "override" ? "✚ Added" : "Algorithm"}
          </span>
        </div>

        {/* Boost input — w-16; ring turns amber when boosted */}
        <div className="shrink-0 w-16 flex items-center justify-center gap-1">
          <span className="sm:hidden text-xs text-gray-400">Boost</span>
          <input
            type="number"
            min={0}
            max={100}
            value={boost}
            onChange={(e) => setBoost(Number(e.target.value))}
            onBlur={handleBoostBlur}
            className={`w-14 px-2 py-1 border rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-amber-400 ${
              boost > 0
                ? "border-amber-300 bg-amber-50 text-amber-800 font-semibold"
                : "border-gray-300"
            }`}
          />
        </div>

        {/* Exclude from discover — w-24 */}
        <div className="shrink-0 w-24 flex items-center justify-center">
          {excludeAction ? (
            <span
              className={`text-xs font-medium text-center leading-tight ${
                excludeAction === "excluding" ? "text-red-600" : "text-green-600"
              }`}
            >
              {excludeAction === "excluding" ? "Excluding…" : "Restoring…"}
            </span>
          ) : (
            <label className="flex items-center gap-1.5 cursor-pointer group">
              <input
                type="checkbox"
                checked={event.excludeFromDiscover}
                onChange={(e) => handleExcludeToggle(e.target.checked)}
                className="rounded border-gray-300 text-red-500 focus:ring-red-400 cursor-pointer"
              />
              <span className="sm:hidden text-xs text-gray-500 group-hover:text-gray-700">
                Exclude
              </span>
            </label>
          )}
        </div>

        {/* Nix button — w-20, right-aligned */}
        <div className="shrink-0 w-20 flex justify-end">
          <button
            onClick={() => setNixOpen((o) => !o)}
            disabled={isPending}
            className={`text-xs px-2.5 py-1 rounded border font-medium transition-colors disabled:opacity-50 ${
              nixOpen
                ? "bg-red-50 border-red-300 text-red-700"
                : "bg-white border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
            }`}
          >
            Nix
          </button>
        </div>
      </div>

      {/* ── Nix confirmation panel (inline, below the row) ─────────────────── */}
      {nixOpen && (
        <div className="mx-4 mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs font-medium text-red-800 mb-2">
            Remove <strong>{event.title}</strong> from this rail?
            <span className="ml-1 font-normal text-red-600">
              Other events from {event.venueName} are not affected.
            </span>
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
              {isPending ? "Removing…" : "Confirm remove"}
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
