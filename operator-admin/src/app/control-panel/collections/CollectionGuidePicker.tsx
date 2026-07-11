"use client";

import { useEffect, useState } from "react";
import type { GuideCandidate } from "@/lib/data/collections";

/**
 * Guide Collection membership picker. Guide Collections are manual-only in
 * V1 (no algorithmic guide feed exists yet — see collection_guide_items'
 * migration 058 header comment), so this is a plain ordered add/remove list,
 * no action/boost controls — same reduced shape as the
 * collection_guide_items table itself.
 *
 * content_guides is a small, geography-scoped table (candidates are
 * preloaded server-side, already filtered to this Collection's Market/City —
 * see getEligibleGuidesForCollection), so search is a client-side filter over
 * the preloaded list rather than a server round trip — mirrors
 * GuideFaqsSelector's own faqLibrary handling for the same reason.
 */

export type GuideMembershipRow = { id: string; title: string; status: "draft" | "published" };

type Props = {
  candidates: GuideCandidate[];
  initialRows: GuideMembershipRow[];
  /** Reports the live row count up for the Collection Checklist's "at least one resolved item" item — mirrors GuideForm.tsx's AttachmentsSelector onSelectionChange convention. */
  onRowsChange?: (count: number) => void;
};

export default function CollectionGuidePicker({ candidates, initialRows, onRowsChange }: Props) {
  const [rows, setRows] = useState<GuideMembershipRow[]>(initialRows);
  const [query, setQuery] = useState("");

  useEffect(() => {
    onRowsChange?.(rows.length);
  }, [rows, onRowsChange]);

  const selectedIds = new Set(rows.map((r) => r.id));
  const available = candidates.filter(
    (c) => !selectedIds.has(c.id) && c.title.toLowerCase().includes(query.trim().toLowerCase())
  );

  function addRow(candidate: GuideCandidate) {
    setRows((prev) => [...prev, { id: candidate.id, title: candidate.title, status: candidate.status }]);
    setQuery("");
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function moveRow(index: number, direction: -1 | 1) {
    setRows((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const serialized = JSON.stringify(rows.map((r) => r.id));
  const draftCount = rows.filter((r) => r.status === "draft").length;

  return (
    <div className="space-y-4">
      <input type="hidden" name="guide_items" value={serialized} />

      {rows.length === 0 && <p className="text-sm text-gray-400">No guides added yet.</p>}

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-3 px-3 py-2 bg-white border border-gray-200 rounded-lg"
            >
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <span className="text-sm font-medium text-slate-800 truncate">{row.title}</span>
                {row.status === "draft" && (
                  <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                    Draft
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => moveRow(index, -1)}
                  disabled={index === 0}
                  className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={`Move ${row.title} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveRow(index, 1)}
                  disabled={index === rows.length - 1}
                  className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={`Move ${row.title} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="ml-1 text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draftCount > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
          {draftCount} of the guides in this Collection {draftCount === 1 ? "is" : "are"} still Draft. A Published
          Collection can reference Draft guides while you finish curating, but Draft content won&apos;t be publicly
          usable until those guides are published too.
        </p>
      )}

      {/* Search */}
      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search guides by title…"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none"
        />
        {candidates.length === 0 ? (
          <p className="mt-1.5 text-xs text-gray-400">
            No guides exist yet for this Collection&apos;s geography.
          </p>
        ) : (
          <>
            <p className="mt-1.5 text-xs text-gray-400">
              Showing guides matching this Collection&apos;s geography, both Draft and Published.
            </p>
            {available.length > 0 && (
              <ul className="mt-1 bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 shadow-resting max-h-64 overflow-y-auto">
                {available.slice(0, 20).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => addRow(c)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-amber-50 transition-colors"
                    >
                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        <span className="font-medium text-slate-800 truncate">{c.title}</span>
                        {c.status === "draft" && (
                          <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                            Draft
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-medium text-amber-600 shrink-0">+ Add</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim() && available.length === 0 && (
              <p className="mt-1 text-xs text-gray-400">No matching guides found.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
