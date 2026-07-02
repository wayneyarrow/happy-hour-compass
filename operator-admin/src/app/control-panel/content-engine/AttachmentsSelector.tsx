"use client";

import { useEffect, useState, useTransition } from "react";
import type {
  AttachmentCandidate,
  GuideAttachmentItem,
  MatchTier,
} from "@/lib/data/contentGuideAttachments";
import {
  searchVenueAttachmentCandidatesAction,
  searchEventAttachmentCandidatesAction,
} from "./actions";

/**
 * Venue/event attachment selector for the Content Engine guide form (Card 3).
 *
 * Search runs server-side (searchVenue/EventAttachmentCandidatesAction),
 * prioritizing results by proximity to the guide's current location —
 * neighbourhood match, then city match, then market — per the Search Origin
 * Priority pattern in the Website Product Playbook's Geographic Information
 * Architecture. Selection order is maintained client-side and persisted via
 * the hidden "attachment_ids" input, read by createGuideAction /
 * updateGuideAction in actions.ts.
 *
 * GuideForm remounts this component (key={guideType}) whenever guide_type
 * changes, since venue ids and event ids are never interchangeable — a fresh
 * mount means a fresh, empty selection rather than risking a venue id being
 * submitted as an "event" attachment or vice versa.
 */

type Kind = "venue" | "event";

type Props = {
  kind: Kind;
  marketId: string;
  cityId: string;
  neighbourhoodId: string;
  initialSelected: GuideAttachmentItem[];
};

const TIER_LABEL: Record<MatchTier, string> = {
  neighbourhood: "Same neighbourhood",
  city: "Same city",
  market: "Same market",
  other: "",
};

const TIER_BADGE_CLS: Record<MatchTier, string> = {
  neighbourhood: "bg-emerald-100 text-emerald-700",
  city: "bg-sky-100 text-sky-700",
  market: "bg-gray-100 text-gray-500",
  other: "",
};

const SEARCH_ACTION: Record<Kind, typeof searchVenueAttachmentCandidatesAction> = {
  venue: searchVenueAttachmentCandidatesAction,
  event: searchEventAttachmentCandidatesAction,
};

/**
 * Group heading shown above a run of same-tier results in the default
 * (no search text) list — this is what makes market-tier "padding" results
 * clearly separated from the guide's own city/neighbourhood, rather than
 * blending in as if they were equally relevant. `isFirstGroup` is true only
 * for the very first tier present (the narrowest one the guide has
 * selected) — when the market tier IS that first/only group (no city or
 * neighbourhood selected), no heading is shown since the helper text above
 * the list already explains the scope.
 */
function tierGroupHeading(tier: MatchTier, isFirstGroup: boolean): string | null {
  switch (tier) {
    case "neighbourhood":
      return "In this neighbourhood";
    case "city":
      return isFirstGroup ? "In this city" : "Also in this city";
    case "market":
      return isFirstGroup ? null : "More from this market";
    case "other":
      return "Other matches";
  }
}

export default function AttachmentsSelector({
  kind,
  marketId,
  cityId,
  neighbourhoodId,
  initialSelected,
}: Props) {
  const [selected, setSelected] = useState<GuideAttachmentItem[]>(initialSelected);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AttachmentCandidate[]>([]);
  const [isSearching, startSearch] = useTransition();
  const [hasSearched, setHasSearched] = useState(false);

  const label = kind === "venue" ? "venue" : "event";
  const searchAction = SEARCH_ACTION[kind];

  useEffect(() => {
    if (!marketId) {
      setResults([]);
      return;
    }
    const excludeIds = selected.map((s) => s.id);
    const handle = setTimeout(
      () => {
        startSearch(async () => {
          const res = await searchAction({
            marketId,
            cityId: cityId || null,
            neighbourhoodId: neighbourhoodId || null,
            query,
            excludeIds,
          });
          setResults(res);
          setHasSearched(true);
        });
      },
      query.trim() ? 250 : 0
    );
    return () => clearTimeout(handle);
  }, [marketId, cityId, neighbourhoodId, query, selected, searchAction]);

  function addItem(candidate: AttachmentCandidate) {
    setSelected((prev) => [
      ...prev,
      {
        id: candidate.id,
        primaryLabel: candidate.primaryLabel,
        secondaryLabel: candidate.secondaryLabel,
      },
    ]);
    setQuery("");
  }

  function removeItem(id: string) {
    setSelected((prev) => prev.filter((s) => s.id !== id));
  }

  function moveItem(index: number, direction: -1 | 1) {
    setSelected((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  if (!marketId) {
    return (
      <p className="text-sm text-gray-400">
        Select a market above to search for {label}s to attach.
      </p>
    );
  }

  const hasQuery = query.trim().length > 0;

  // Describes what the list below represents — see Card 3 touch-up: admins
  // were confused when a city's default list quietly padded out with
  // unrelated same-market records. This makes the scope (and that it's a
  // capped "top matches" list, not the full market) explicit up front.
  const scopeHelperText = hasQuery
    ? "Searching across all markets — closest matches to this location are shown first."
    : neighbourhoodId
    ? `Showing top matches for this neighbourhood. Search by name to find more ${label}s.`
    : cityId
    ? `Showing top matches for this city. Search by name to find more ${label}s.`
    : `Showing top matches for this market. Search by name to find more ${label}s.`;

  const emptyResultsText = hasQuery
    ? `No ${label}s found.`
    : neighbourhoodId
    ? `No published ${label}s in this neighbourhood yet. Search by name to find more.`
    : cityId
    ? `No published ${label}s in this city yet. Search by name to find more.`
    : `No published ${label}s in this market yet.`;

  return (
    <div className="space-y-4">
      <input type="hidden" name="attachment_ids" value={selected.map((s) => s.id).join(",")} />

      {/* Selected, ordered list */}
      {selected.length > 0 && (
        <ul className="space-y-2">
          {selected.map((item, index) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 px-3 py-2 bg-white border border-gray-200 rounded-lg"
            >
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium text-slate-800 block truncate">
                  {item.primaryLabel}
                </span>
                {item.secondaryLabel && (
                  <span className="text-xs text-gray-400 block truncate">{item.secondaryLabel}</span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => moveItem(index, -1)}
                  disabled={index === 0}
                  className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={`Move ${item.primaryLabel} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(index, 1)}
                  disabled={index === selected.length - 1}
                  className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label={`Move ${item.primaryLabel} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="ml-1 text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Search */}
      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${label}s by name…`}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-gray-400">{scopeHelperText}</p>
        {isSearching && <p className="mt-1 text-xs text-gray-400">Searching…</p>}
        {!isSearching && hasSearched && results.length === 0 && (
          <p className="mt-1 text-xs text-gray-400">{emptyResultsText}</p>
        )}
        {!isSearching && results.length > 0 && (
          <ul className="mt-1 bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 shadow-resting max-h-64 overflow-y-auto">
            {results.map((r, index) => {
              // Only the default (no query) list groups by tier with a
              // heading — that's the confusing case this touch-up targets.
              // Search results keep the flat list + per-item badge, which
              // was already accurate.
              const heading = !hasQuery && (index === 0 || results[index - 1].matchTier !== r.matchTier)
                ? tierGroupHeading(r.matchTier, index === 0)
                : null;

              return (
                <li key={r.id}>
                  {heading && (
                    <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-50">
                      {heading}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => addItem(r)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-amber-50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-slate-800 block truncate">{r.primaryLabel}</span>
                      {r.secondaryLabel && (
                        <span className="text-xs text-gray-400 block truncate">{r.secondaryLabel}</span>
                      )}
                    </div>
                    {TIER_LABEL[r.matchTier] && (
                      <span
                        className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${TIER_BADGE_CLS[r.matchTier]}`}
                      >
                        {TIER_LABEL[r.matchTier]}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-1 text-xs text-gray-400">
          Only published {label}s can be attached to a guide.
        </p>
      </div>
    </div>
  );
}
