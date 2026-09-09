"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Market } from "@/lib/markets";
import type { VenueSuggestion } from "@/lib/data/venueSuggestions";
import type { DailySpecialSuggestion } from "./dailySpecialSuggestions";
import type { EventSuggestion } from "./eventSuggestions";
import {
  suggestHomepageVenuesAction,
  suggestHomepageDailySpecialsAction,
  suggestHomepageEventsAction,
} from "./suggestActions";
import { fireWebsiteSearch } from "./searchTracking";
import { DISCOVERY_MODES, type DiscoveryMode } from "@/lib/homepageDiscoveryModes";

type Props = {
  market: Market;
  mode: DiscoveryMode;
};

const DEBOUNCE_MS = 200;

/**
 * A discovery-mode result, still a distinct, honestly-named entity per
 * mode (VenueSuggestion / DailySpecialSuggestion / EventSuggestion, each
 * with its own real field names) — `kind` only tags which one so a single
 * list can drive shared keyboard-nav/selection/rendering logic without
 * coercing every entity into a shared venue-shaped object.
 */
type DiscoveryResult =
  | ({ kind: "venue" } & VenueSuggestion)
  | ({ kind: "daily_special" } & DailySpecialSuggestion)
  | ({ kind: "event" } & EventSuggestion);

/**
 * Fetches this mode's suggestions from its own server action — Happy
 * Hours searches venues, Daily Specials searches Daily Special records,
 * Events searches Event records (see suggestActions.ts's header comment
 * and each mode's own search module). Never falls back to a different
 * entity type for a mode it doesn't apply to.
 */
async function fetchDiscoveryResults(
  mode: DiscoveryMode,
  marketId: string,
  query: string
): Promise<DiscoveryResult[]> {
  switch (mode) {
    case "happy_hours": {
      const venues = await suggestHomepageVenuesAction(marketId, query);
      return venues.map((v) => ({ kind: "venue" as const, ...v }));
    }
    case "daily_specials": {
      const specials = await suggestHomepageDailySpecialsAction(marketId, query);
      return specials.map((s) => ({ kind: "daily_special" as const, ...s }));
    }
    case "events": {
      const events = await suggestHomepageEventsAction(marketId, query);
      return events.map((e) => ({ kind: "event" as const, ...e }));
    }
  }
}

/** Empty-state copy — Happy Hours keeps its exact pre-existing "No venues found." wording; the two new modes get their own equivalents. */
function emptyMessageFor(mode: DiscoveryMode): string {
  if (mode === "happy_hours") return "No venues found.";
  if (mode === "daily_specials") return "No daily specials found.";
  return "No events found.";
}

/** Listbox aria-label — Happy Hours keeps its exact pre-existing "Venue suggestions" wording. */
function listboxLabelFor(mode: DiscoveryMode): string {
  if (mode === "happy_hours") return "Venue suggestions";
  if (mode === "daily_specials") return "Daily Special suggestions";
  return "Event suggestions";
}

/**
 * The Hero's search pill — Happy Hours / Daily Specials / Events, each
 * searching its own entity type (see DiscoveryResult above). Renamed from
 * HeroVenueSearch: extracted from HeroSection so that component's diff
 * stays legible — this owns all interactive behavior (debounced fetch,
 * dropdown, keyboard nav, click-outside) while the pill's outer classes
 * are unchanged from the original static markup.
 *
 * Two distinct navigation outcomes, both driven by the same suggestion
 * request — no second query:
 *   - Selecting an individual result navigates directly to its own page
 *     (a venue's page, a Special's exact anchor on its venue's page, or
 *     an Event's page).
 *   - Selecting the "See all …" discovery action (shown only for modes
 *     whose destination has a `?q=` search results contract — see
 *     DISCOVERY_MODES.supportsQuerySearch) navigates to that mode's own
 *     search results page with the same query applied via ?q=.
 *
 * Mode-switch safety: switching `mode` while a query is still typed keeps
 * the query text (useful for comparing modes) but immediately invalidates
 * any in-flight fetch for the previous mode and clears its results, so a
 * slow Happy Hours response can never render under Daily Specials (or vice
 * versa) — see the mode-change effect below and requestIdRef.
 */
export function HeroDiscoverySearch({ market, mode }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const modeRef = useRef(mode);
  // Phase 4B search tracking: the last trimmed query we've already fired a
  // website_search_events row for. Prevents firing a duplicate event for the
  // exact same settled query across rerenders (e.g. the click-outside effect
  // or an unrelated parent rerender) — reset to "" whenever the query is
  // cleared, so retyping the same term later still counts as a fresh search.
  // Also reset on a genuine mode change (see below): the same typed text
  // searched under a different entity type is a distinct search, not a
  // repeat of the one already logged for the previous mode.
  const lastTrackedQueryRef = useRef("");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DiscoveryResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const config = DISCOVERY_MODES[mode];
  const discoveryHref = config.supportsQuerySearch ? config.destination : undefined;

  // Mode changed — clear the previous mode's results/loading state
  // synchronously (no stale-entity flash) and invalidate any in-flight
  // fetch for the old mode. The query-driven effect below (which also
  // depends on `mode`) then re-fetches the current query, if any, against
  // the new mode. Skipped on initial mount (modeRef starts equal to mode).
  useEffect(() => {
    if (modeRef.current === mode) return;
    modeRef.current = mode;
    requestIdRef.current++;
    lastTrackedQueryRef.current = "";
    setResults([]);
    setHasSearched(false);
    setActiveIndex(-1);
  }, [mode]);

  // Debounced suggestion fetch. requestIdRef guards against an older,
  // slower request (from a stale query OR a since-abandoned mode)
  // resolving after a newer one and clobbering fresher results.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsLoading(false);
      setHasSearched(false);
      setActiveIndex(-1);
      lastTrackedQueryRef.current = "";
      return;
    }

    setIsLoading(true);
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      fetchDiscoveryResults(mode, market.id, trimmed).then((discoveryResults) => {
        if (requestIdRef.current !== requestId) return;
        setResults(discoveryResults);
        setIsLoading(false);
        setHasSearched(true);
        setActiveIndex(-1);

        // Phase 4B: one website_search_events row per settled, meaningful
        // query — resultCount is exactly the suggestion set the visitor
        // sees, for whichever entity type this mode actually searched
        // (venues / Daily Specials / Events), each already capped to a
        // useful top-N by its own search module.
        if (trimmed !== lastTrackedQueryRef.current) {
          lastTrackedQueryRef.current = trimmed;
          fireWebsiteSearch({
            searchTerm: trimmed,
            surface: "homepage_hero",
            resultCount: discoveryResults.length,
            marketId: market.id,
          });
        }
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, market.id, mode]);

  // Clicking outside the pill/dropdown closes the dropdown.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function selectResult(result: DiscoveryResult) {
    setIsOpen(false);
    router.push(result.href);
  }

  function selectDiscovery() {
    const trimmed = query.trim();
    if (!discoveryHref || !trimmed) return;
    setIsOpen(false);
    router.push(`${discoveryHref}?q=${encodeURIComponent(trimmed)}`);
  }

  // The discovery action is a match option like any individual result — for
  // Happy Hours (the pre-existing mode) it only appears once we know at
  // least one venue actually matched, unchanged from before. For the two
  // new modes it may also appear on a zero-match search, so a query with no
  // live suggestions still has a way to open the full discovery page (see
  // this task's Dropdown Structure guidance) — Happy Hours' own behavior is
  // deliberately left exactly as it was.
  const showDiscoveryAction =
    !!discoveryHref && !isLoading && hasSearched && (results.length > 0 || mode !== "happy_hours");
  const totalOptions = results.length + (showDiscoveryAction ? 1 : 0);
  const discoveryIndex = 0;
  const resultStartIndex = showDiscoveryAction ? 1 : 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (totalOptions === 0) return;
      setIsOpen(true);
      setActiveIndex((i) => Math.min(i + 1, totalOptions - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (totalOptions === 0) return;
      setIsOpen(true);
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (isOpen && activeIndex >= 0) {
        if (showDiscoveryAction && activeIndex === discoveryIndex) {
          e.preventDefault();
          selectDiscovery();
        } else {
          const result = results[activeIndex - resultStartIndex];
          if (result) {
            e.preventDefault();
            selectResult(result);
          }
        }
      }
    } else if (e.key === "Escape") {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    }
  }

  const showDropdown = isOpen && query.trim().length > 0;

  return (
    <div ref={containerRef} className="mt-3 w-full max-w-xl relative">
      <div
        className="
          w-full flex items-center gap-3 pl-5 pr-5 py-[14px]
          bg-white border border-gray-200 rounded-full text-left
          shadow-[0_2px_12px_rgba(0,0,0,0.07),0_1px_4px_rgba(0,0,0,0.04)]
          hover:shadow-[0_4px_20px_rgba(0,0,0,0.10),0_2px_8px_rgba(0,0,0,0.06)]
          hover:border-gray-300
          focus-within:ring-2 focus-within:ring-amber-400 focus-within:ring-offset-2
          transition-all duration-200
        "
      >
        <svg
          className="w-4 h-4 text-gray-400 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="hero-discovery-search-listbox"
          aria-autocomplete="list"
          aria-label={config.searchAriaLabel}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (query.trim()) setIsOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={config.searchPlaceholder}
          autoComplete="off"
          className="flex-1 min-w-0 text-[14px] text-gray-900 placeholder:text-gray-400 bg-transparent outline-none"
        />
      </div>

      {showDropdown && (
        <div
          id="hero-discovery-search-listbox"
          role="listbox"
          aria-label={listboxLabelFor(mode)}
          className="absolute left-0 right-0 top-full mt-2 bg-white border border-gray-200 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden z-20 text-left"
        >
          {isLoading ? (
            <p className="px-5 py-4 text-sm text-gray-400">Searching…</p>
          ) : results.length > 0 || showDiscoveryAction ? (
            <>
              {/* Discovery action — its own single-item list (valid <li>-in-<ul>
                  nesting, matching each result's markup shape), shown first
                  so users see "browse everything matching this" before the
                  specific results below (or, for a zero-match Daily
                  Specials/Events search, as the only option). Kept outside
                  the results list's max-h-80/overflow-y-auto so it's always
                  visible without scrolling, on desktop and mobile alike. */}
              {showDiscoveryAction && (
                <ul className="border-b border-gray-100 py-1">
                  <li role="option" aria-selected={activeIndex === discoveryIndex}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={selectDiscovery}
                      onMouseEnter={() => setActiveIndex(discoveryIndex)}
                      aria-label={`See all ${config.discoveryActionLabel} matching "${query.trim()}"`}
                      className={`w-full flex items-center gap-2 text-left px-5 py-3 transition-colors ${
                        activeIndex === discoveryIndex ? "bg-amber-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <svg
                        className="w-3.5 h-3.5 text-amber-500 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                      <span className="text-sm font-semibold text-amber-700">
                        See all {config.discoveryActionLabel} matching &ldquo;{query.trim()}&rdquo;
                      </span>
                    </button>
                  </li>
                </ul>
              )}

              {results.length > 0 && (
                <ul className="max-h-80 overflow-y-auto py-1">
                  {results.map((result, i) => {
                    const optionIndex = resultStartIndex + i;
                    return (
                      <li key={`${result.kind}-${result.id}`} role="option" aria-selected={optionIndex === activeIndex}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectResult(result)}
                          onMouseEnter={() => setActiveIndex(optionIndex)}
                          className={`w-full text-left px-5 py-3 flex flex-col gap-0.5 transition-colors ${
                            optionIndex === activeIndex ? "bg-amber-50" : "hover:bg-gray-50"
                          }`}
                        >
                          {result.kind === "venue" && (
                            <>
                              <span className="text-sm font-semibold text-gray-900">{result.name}</span>
                              <span className="text-xs text-gray-500">
                                {[result.area, result.city].filter(Boolean).join(" · ")}
                                {result.address ? ` — ${result.address}` : ""}
                              </span>
                            </>
                          )}
                          {result.kind === "daily_special" && (
                            <>
                              <span className="text-sm font-semibold text-gray-900">{result.title}</span>
                              <span className="text-xs text-gray-500">
                                {[result.venueName, result.contextLabel].filter(Boolean).join(" · ")}
                              </span>
                            </>
                          )}
                          {result.kind === "event" && (
                            <>
                              <span className="text-sm font-semibold text-gray-900">
                                {result.typeEmoji ? `${result.typeEmoji} ` : ""}
                                {result.title}
                              </span>
                              <span className="text-xs text-gray-500">
                                {[result.venueName, result.occurrenceLabel].filter(Boolean).join(" · ")}
                              </span>
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : hasSearched ? (
            <p className="px-5 py-4 text-sm text-gray-400">{emptyMessageFor(mode)}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
