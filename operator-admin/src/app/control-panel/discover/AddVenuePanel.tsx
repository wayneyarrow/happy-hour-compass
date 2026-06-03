"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConsumerVenue } from "@/lib/data/venues";
import type { RailKey } from "@/lib/data/discoverOverridesShared";
import { INCLUDE_REASON_TYPES } from "@/lib/data/discoverOverridesShared";
import { addToRailAction } from "./actions";

type Props = {
  candidates: ConsumerVenue[];
  railKey: RailKey;
};

const PLAN_BADGE: Record<string, string> = {
  premium:    "bg-amber-100 text-amber-800",
  enterprise: "bg-purple-100 text-purple-800",
  pro:        "bg-blue-100 text-blue-800",
  free:       "bg-gray-100 text-gray-500",
};

export function AddVenuePanel({ candidates, railKey }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ConsumerVenue | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filtered = query.trim().length >= 1
    ? candidates.filter((v) =>
        v.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : [];

  const handleAdd = () => {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      if (reason) fd.set("reason_type", reason);
      if (note.trim()) fd.set("note", note.trim());
      const result = await addToRailAction(railKey, selected.venueUuid, null, fd);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setQuery("");
      setSelected(null);
      setReason("");
      setNote("");
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-800 font-medium transition-colors"
      >
        <span className="text-base leading-none">+</span> Add venue to this rail
      </button>
    );
  }

  return (
    <div className="mt-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <p className="text-xs font-medium text-amber-800 mb-3">
        Add a venue to this rail. It must be a local, published venue.
      </p>

      {/* Search */}
      {!selected && (
        <div className="mb-3">
          <input
            type="text"
            placeholder="Search by venue name…"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:outline-none bg-white"
          />
          {filtered.length > 0 && (
            <ul className="mt-1 bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 shadow-sm max-h-52 overflow-y-auto">
              {filtered.map((v) => (
                <li key={v.venueUuid}>
                  <button
                    type="button"
                    onClick={() => { setSelected(v); setQuery(""); }}
                    className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-amber-50 transition-colors"
                  >
                    <div>
                      <span className="font-medium text-slate-800">{v.name}</span>
                      <span className="ml-2 text-xs text-gray-400">{v.city}</span>
                    </div>
                    <span
                      className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full capitalize shrink-0 ${
                        PLAN_BADGE[v.operatorPlan] ?? PLAN_BADGE.free
                      }`}
                    >
                      {v.operatorPlan}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 1 && filtered.length === 0 && (
            <p className="mt-2 text-xs text-gray-400">No matching local venues.</p>
          )}
        </div>
      )}

      {/* Selected venue + confirm */}
      {selected && (
        <div className="mb-3">
          <div className="flex items-center justify-between p-2 bg-white border border-gray-200 rounded-lg">
            <div>
              <span className="text-sm font-medium text-slate-800">{selected.name}</span>
              <span
                className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
                  PLAN_BADGE[selected.operatorPlan] ?? PLAN_BADGE.free
                }`}
              >
                {selected.operatorPlan}
              </span>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-xs text-gray-400 hover:text-gray-600 ml-3"
            >
              Change
            </button>
          </div>

          {/* Reason + note */}
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="text-xs px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-amber-400 bg-white"
            >
              <option value="">Reason (optional)</option>
              {INCLUDE_REASON_TYPES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="flex-1 min-w-32 text-xs px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-amber-400"
            />
          </div>

          {error && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={handleAdd}
              disabled={isPending}
              className="text-sm px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
            >
              {isPending ? "Adding…" : "Add to rail"}
            </button>
            <button
              onClick={() => { setOpen(false); setSelected(null); setQuery(""); }}
              className="text-sm px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!selected && (
        <button
          onClick={() => { setOpen(false); setQuery(""); }}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
