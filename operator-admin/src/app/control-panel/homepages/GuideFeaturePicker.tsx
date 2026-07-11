"use client";

import { useMemo, useState } from "react";
import type { HomepageGuideFeatureCandidate } from "@/lib/data/homepages";

/**
 * Single-select picker for a Guide Feature Section's content step. Guides
 * are a small, fully-loaded reference list (unlike venues/events, which use
 * FeatureContentPicker.tsx's server-side search) — mirrors
 * CollectionGuidePicker.tsx's own "load once, filter client-side" approach
 * for Guide Collection membership.
 */

type SelectedContent = { id: string; label: string };

type Props = {
  candidates: HomepageGuideFeatureCandidate[];
  usedIds: Set<string>;
  selected: SelectedContent | null;
  onSelect: (candidate: SelectedContent) => void;
  onClear: () => void;
};

export default function GuideFeaturePicker({ candidates, usedIds, selected, onSelect, onClear }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.title.toLowerCase().includes(q));
  }, [candidates, query]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
        <span className="text-sm font-medium text-slate-800 truncate">{selected.label}</span>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
        >
          Change
        </button>
      </div>
    );
  }

  if (candidates.length === 0) {
    return <p className="text-sm text-gray-400">No published Guides available for this Homepage&apos;s geography.</p>;
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search guides by title…"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none"
      />
      <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-sm text-gray-400">No guides match &quot;{query}&quot;.</li>
        ) : (
          filtered.map((g) => {
            const used = usedIds.has(g.id);
            return (
              <li key={g.id}>
                <button
                  type="button"
                  disabled={used}
                  onClick={() => onSelect({ id: g.id, label: g.title })}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    used ? "opacity-50 cursor-not-allowed" : "hover:bg-amber-50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800 block truncate">{g.title}</span>
                    <span className="text-xs text-gray-400 block truncate">
                      {g.cityName ? `${g.cityName} · ${g.marketName}` : g.marketName}
                    </span>
                  </div>
                  {used && <span className="ml-2 text-xs font-medium text-amber-600 shrink-0">Already used on this Homepage</span>}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
