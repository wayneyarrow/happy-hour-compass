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
 * Combined Saved page content — renders Saved Venues and Saved Events sections.
 *
 * Reads savedVenues + savedEvents from localStorage (same keys as
 * BookmarkButton and EventBookmarkButton) and filters the full venue/event
 * lists to only show bookmarked items. Mirrors the original index.html
 * renderSavedPage() in-memory lookup pattern.
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

  // Avoid flash before localStorage read
  if (!hydrated) return null;

  const savedVenues = allVenues.filter((v) => savedVenueIds.has(v.id));
  const savedEvents = allEvents.filter((e) => savedEventIds.has(e.id));
  const hasAnything = savedVenues.length > 0 || savedEvents.length > 0;

  // Overall empty state — matches original index.html favorites empty state
  if (!hasAnything) {
    return (
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
    );
  }

  return (
    <div className="space-y-8">
      {/* Saved Venues section */}
      {savedVenues.length > 0 && (
        <section>
          <p className="text-sm font-semibold text-gray-700 mb-4">
            Saved Venues
          </p>
          <VenueList venues={savedVenues} />
        </section>
      )}

      {/* Saved Events section */}
      <section>
        <p className="text-sm font-semibold text-gray-700 mb-4">
          Saved Events
        </p>
        {savedEvents.length === 0 ? (
          <p className="text-sm text-gray-500">No saved events yet.</p>
        ) : (
          <ul className="space-y-px">
            {savedEvents.map((event) => (
              <li key={event.id}>
                <EventCard event={event} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
