"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Market } from "@/lib/markets";
import type { VenueSuggestion } from "@/lib/data/venueSuggestions";
import { suggestHomepageVenuesAction } from "./suggestActions";

type Props = {
  market: Market;
  placeholder: string;
  ariaLabel: string;
  /**
   * Base path for the "See all happy hours matching …" discovery action
   * (e.g. "/website-happy-hours"). The action is appended with
   * `?q=<query>` and only rendered when this is provided — omit it to keep
   * this instance venue-suggestions-only (e.g. the homepage's Events mode,
   * which has no query-aware search results page to send users to yet).
   */
  discoveryHref?: string;
};

const DEBOUNCE_MS = 200;

/**
 * The Hero's search pill, wired up to live venue suggestions. Extracted from
 * HeroSection so that component's diff stays legible — this owns all of the
 * new interactive behavior (debounced fetch, dropdown, keyboard nav,
 * click-outside) while the pill's outer classes are copied verbatim from the
 * previous static <button> so its resting appearance is unchanged (still the
 * same padding, border, rounded-full, shadow, and hover states — the only
 * structural difference is a real <input> in place of a <span>, which is
 * what "fully functional" requires).
 *
 * Two distinct navigation outcomes, both driven by the same suggestion
 * request — no second query:
 *   - Selecting a venue suggestion navigates directly to that venue's page.
 *   - Selecting the discovery action (shown only when discoveryHref is set
 *     and at least one venue matches) navigates to the Happy Hour search
 *     results page with the same query applied via ?q=.
 */
export function HeroVenueSearch({ market, placeholder, ariaLabel, discoveryHref }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VenueSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Debounced suggestion fetch. requestIdRef guards against an older,
  // slower request resolving after a newer one and clobbering fresher results.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsLoading(false);
      setHasSearched(false);
      setActiveIndex(-1);
      return;
    }

    setIsLoading(true);
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      suggestHomepageVenuesAction(market.id, trimmed).then((suggestions) => {
        if (requestIdRef.current !== requestId) return;
        setResults(suggestions);
        setIsLoading(false);
        setHasSearched(true);
        setActiveIndex(-1);
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, market.id]);

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

  function selectVenue(venue: VenueSuggestion) {
    setIsOpen(false);
    router.push(venue.href);
  }

  function selectDiscovery() {
    const trimmed = query.trim();
    if (!discoveryHref || !trimmed) return;
    setIsOpen(false);
    router.push(`${discoveryHref}?q=${encodeURIComponent(trimmed)}`);
  }

  // The discovery action is a match option like any venue suggestion — it
  // only makes sense once we know at least one venue actually matched the
  // query, using the exact same request/response already fetched above
  // (no separate "does anything match" query).
  //
  // Rendered first (index 0) so users see "browse everything matching this"
  // before the specific-venue suggestions — venue options shift down by
  // venueStartIndex to keep a single contiguous keyboard-navigable range.
  const showDiscoveryAction =
    !!discoveryHref && !isLoading && hasSearched && results.length > 0;
  const totalOptions = results.length + (showDiscoveryAction ? 1 : 0);
  const discoveryIndex = 0;
  const venueStartIndex = showDiscoveryAction ? 1 : 0;

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
          const venue = results[activeIndex - venueStartIndex];
          if (venue) {
            e.preventDefault();
            selectVenue(venue);
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
          aria-controls="hero-venue-search-listbox"
          aria-autocomplete="list"
          aria-label={ariaLabel}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (query.trim()) setIsOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          className="flex-1 min-w-0 text-[14px] text-gray-900 placeholder:text-gray-400 bg-transparent outline-none"
        />
      </div>

      {showDropdown && (
        <div
          id="hero-venue-search-listbox"
          role="listbox"
          aria-label="Venue suggestions"
          className="absolute left-0 right-0 top-full mt-2 bg-white border border-gray-200 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden z-20 text-left"
        >
          {isLoading ? (
            <p className="px-5 py-4 text-sm text-gray-400">Searching…</p>
          ) : results.length > 0 ? (
            <>
              {/* Discovery action — its own single-item list (valid <li>-in-<ul>
                  nesting, matching the venue items' markup shape), shown first
                  so users see "browse everything matching this" before the
                  specific-venue suggestions below. Kept outside the venue
                  list's max-h-80/overflow-y-auto so it's always visible
                  without scrolling, on desktop and mobile alike. */}
              {showDiscoveryAction && (
                <ul className="border-b border-gray-100 py-1">
                  <li role="option" aria-selected={activeIndex === discoveryIndex}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={selectDiscovery}
                      onMouseEnter={() => setActiveIndex(discoveryIndex)}
                      aria-label={`See all happy hours matching "${query.trim()}"`}
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
                        See all happy hours matching &ldquo;{query.trim()}&rdquo;
                      </span>
                    </button>
                  </li>
                </ul>
              )}

              <ul className="max-h-80 overflow-y-auto py-1">
                {results.map((venue, i) => {
                  const optionIndex = venueStartIndex + i;
                  return (
                    <li key={venue.id} role="option" aria-selected={optionIndex === activeIndex}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectVenue(venue)}
                        onMouseEnter={() => setActiveIndex(optionIndex)}
                        className={`w-full text-left px-5 py-3 flex flex-col gap-0.5 transition-colors ${
                          optionIndex === activeIndex ? "bg-amber-50" : "hover:bg-gray-50"
                        }`}
                      >
                        <span className="text-sm font-semibold text-gray-900">{venue.name}</span>
                        <span className="text-xs text-gray-500">
                          {[venue.area, venue.city].filter(Boolean).join(" · ")}
                          {venue.address ? ` — ${venue.address}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : hasSearched ? (
            <p className="px-5 py-4 text-sm text-gray-400">No venues found.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
