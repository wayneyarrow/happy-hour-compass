"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ConsumerVenue } from "@/lib/data/venues";
import type { ConsumerEventListItem } from "@/lib/data/events";
import { VenueList } from "../VenueList";
import { EventCard } from "../EventCard";

const VENUES_KEY = "savedVenues";
const EVENTS_KEY = "savedEvents";

function getSavedIds(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

type Props = {
  allVenues: ConsumerVenue[];
  allEvents: ConsumerEventListItem[];
};

/**
 * Combined Saved page content — sticky header + search + Saved Venues / Events.
 *
 * Reads savedVenues + savedEvents from localStorage (same keys as
 * BookmarkButton and EventBookmarkButton) and filters the full venue/event
 * lists to only show bookmarked items. Mirrors the original index.html
 * renderSavedPage() in-memory lookup pattern.
 *
 * Search mirrors original toggleFavoritesSearch / performFavoritesSearch:
 * - toggle button in the header shows/hides the input (icon → ✕ when open)
 * - case-insensitive match on venue.name for venues, and event.title or
 *   event.venueName for events
 *
 * Listens for:
 * - "hhc:savedChanged" custom event — same-tab updates (BookmarkButton /
 *   EventBookmarkButton dispatch this on each toggle)
 * - "storage" — cross-tab sync
 */
export function SavedVenueList({ allVenues, allEvents }: Props) {
  const [savedVenueIds, setSavedVenueIds] = useState<Set<string>>(new Set());
  const [savedEventIds, setSavedEventIds] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  // Search state — mirrors original toggleFavoritesSearch / performFavoritesSearch
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  function toggleSearch() {
    if (searchOpen) {
      setSearchTerm("");
    }
    setSearchOpen((v) => !v);
  }

  function refresh() {
    setSavedVenueIds(getSavedIds(VENUES_KEY));
    setSavedEventIds(getSavedIds(EVENTS_KEY));
  }

  useEffect(() => {
    refresh();
    setHydrated(true);

    function onStorage(e: StorageEvent) {
      if (e.key === VENUES_KEY || e.key === EVENTS_KEY) refresh();
    }
    function onSavedChanged() {
      refresh();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("hhc:savedChanged", onSavedChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("hhc:savedChanged", onSavedChanged);
    };
  }, []);

  const savedVenues = allVenues.filter((v) => savedVenueIds.has(v.id));
  const savedEvents = allEvents.filter((e) => savedEventIds.has(e.id));
  const hasAnything = savedVenues.length > 0 || savedEvents.length > 0;

  // Apply search filter — mirrors performFavoritesSearch:
  // venues matched on name; events matched on title or venue name
  const q = searchTerm.toLowerCase();
  const filteredVenues = q
    ? savedVenues.filter((v) => v.name.toLowerCase().includes(q))
    : savedVenues;
  const filteredEvents = q
    ? savedEvents.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.venueName.toLowerCase().includes(q)
      )
    : savedEvents;

  const searchActive = !!q;
  const noResults = searchActive && filteredVenues.length === 0 && filteredEvents.length === 0;

  return (
    <>
      {/* Sticky page header — matches original .page-header sticky */}
      <div className="sticky top-0 z-50 bg-white border-b border-gray-200 px-5 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-900">Saved</h1>
        {/* Search toggle — only shown when there are saved items; matches original search-toggle-btn */}
        {(hasAnything || !hydrated) && (
          <button
            type="button"
            onClick={toggleSearch}
            aria-label={searchOpen ? "Close search" : "Search saved"}
            className="w-8 h-8 flex items-center justify-center rounded-full text-blue-500 hover:bg-gray-100 transition-colors"
          >
            {searchOpen ? (
              // ✕ close icon — matches original searchToggleBtn.textContent = '✕'
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-5 h-5"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            ) : (
              // 🔍 search icon
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-5 h-5"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Search container (collapsible) — matches original .search-container + .search-wrapper */}
      {searchOpen && (
        <div className="sticky top-[57px] z-[49] bg-white px-5 pt-3 pb-4 border-b border-gray-200">
          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              placeholder="Search saved..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="px-5 py-5">
        {/* Overall empty state — shown when nothing is saved at all */}
        {hydrated && !hasAnything && (
          <div className="flex flex-col items-center justify-center text-center py-16 px-10">
            <div className="text-5xl opacity-50 mb-4">🔖</div>
            <p className="text-lg font-semibold text-gray-700 mb-2">
              No saved places yet
            </p>
            <p className="text-sm text-gray-500 mb-6">
              Tap the bookmark on a venue or event to save it here.
            </p>
            <Link
              href="/"
              className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
            >
              Browse venues
            </Link>
          </div>
        )}

        {/* Search no-results state */}
        {hydrated && hasAnything && noResults && (
          <div className="flex flex-col items-center justify-center text-center py-16 px-10">
            <div className="text-5xl opacity-50 mb-4">🔍</div>
            <p className="text-lg font-semibold text-gray-700 mb-2">
              No results
            </p>
            <p className="text-sm text-gray-500">
              No saved items match &ldquo;{searchTerm}&rdquo;.
            </p>
          </div>
        )}

        {/* Saved sections — shown when hydrated and items exist (filtered or not) */}
        {hydrated && hasAnything && !noResults && (
          <div className="space-y-8">
            {/* Saved Venues section */}
            {filteredVenues.length > 0 && (
              <section>
                <p className="text-sm font-semibold text-gray-700 mb-4">
                  Saved Venues
                </p>
                <VenueList venues={filteredVenues} />
              </section>
            )}

            {/* Saved Events section — only rendered when there are matching saved events */}
            {filteredEvents.length > 0 && (
              <section>
                <p className="text-sm font-semibold text-gray-700 mb-4">
                  Saved Events
                </p>
                <ul className="space-y-px">
                  {filteredEvents.map((event) => (
                    <li key={event.id}>
                      <EventCard event={event} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}
