"use client";

import { useEffect, useState, useTransition } from "react";
import type { AttachmentCandidate, MatchTier } from "@/lib/data/contentGuideAttachments";
import type { FeatureSearchInput } from "./actions";

/**
 * Single-select, search-as-you-type picker for a Venue/Event Feature
 * Section's content step. Modeled on AttachmentsSelector.tsx's search UX
 * (debounced server search, tier badges), but single-select instead of
 * multi-select, and — unlike AttachmentsSelector, which excludes
 * already-attached items entirely — results already used elsewhere on this
 * Homepage stay visible, just disabled with "Already used on this Homepage"
 * (the product's explicit "remain visible but disabled" requirement).
 */

const TIER_LABEL: Record<MatchTier, string> = {
  neighbourhood: "Same neighbourhood",
  city: "Same city",
  market: "Same market",
  other: "",
};

type SelectedContent = { id: string; label: string; secondaryLabel: string | null };

type Props = {
  /** "venue" | "event" — used only for placeholder/empty-state copy. */
  label: string;
  marketId: string;
  cityId: string | null;
  searchAction: (input: FeatureSearchInput) => Promise<AttachmentCandidate[]>;
  usedIds: Set<string>;
  selected: SelectedContent | null;
  onSelect: (candidate: SelectedContent) => void;
  onClear: () => void;
};

export default function FeatureContentPicker({
  label,
  marketId,
  cityId,
  searchAction,
  usedIds,
  selected,
  onSelect,
  onClear,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AttachmentCandidate[]>([]);
  const [isSearching, startSearch] = useTransition();
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (!marketId || selected) {
      setResults([]);
      return;
    }
    const handle = setTimeout(
      () => {
        startSearch(async () => {
          const res = await searchAction({ marketId, cityId, query });
          setResults(res);
          setHasSearched(true);
        });
      },
      query.trim() ? 250 : 0
    );
    return () => clearTimeout(handle);
  }, [marketId, cityId, query, searchAction, selected]);

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
        <div className="min-w-0">
          <span className="text-sm font-medium text-slate-800 block truncate">{selected.label}</span>
          {selected.secondaryLabel && (
            <span className="text-xs text-gray-500 block truncate">{selected.secondaryLabel}</span>
          )}
        </div>
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

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${label}s by name…`}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none"
      />
      {isSearching && <p className="text-xs text-gray-400">Searching…</p>}
      {!isSearching && hasSearched && results.length === 0 && (
        <p className="text-xs text-gray-400">No published {label}s found.</p>
      )}
      {!isSearching && results.length > 0 && (
        <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
          {results.map((r) => {
            const used = usedIds.has(r.id);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={used}
                  onClick={() => onSelect({ id: r.id, label: r.primaryLabel, secondaryLabel: r.secondaryLabel })}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    used ? "opacity-50 cursor-not-allowed" : "hover:bg-amber-50"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800 block truncate">{r.primaryLabel}</span>
                    {r.secondaryLabel && <span className="text-xs text-gray-400 block truncate">{r.secondaryLabel}</span>}
                  </div>
                  {used ? (
                    <span className="ml-2 text-xs font-medium text-amber-600 shrink-0">Already used on this Homepage</span>
                  ) : TIER_LABEL[r.matchTier] ? (
                    <span className="ml-2 text-xs text-gray-400 shrink-0">{TIER_LABEL[r.matchTier]}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-gray-400">Only published {label}s can be featured.</p>
    </div>
  );
}
