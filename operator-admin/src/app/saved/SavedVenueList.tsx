"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ConsumerVenue } from "@/lib/data/venues";
import { VenueList } from "../VenueList";

const STORAGE_KEY = "savedVenues";

function getSavedVenueIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

type Props = {
  allVenues: ConsumerVenue[];
};

/**
 * Reads savedVenues from localStorage (same key as BookmarkButton),
 * filters the full venue list down to saved ones, and renders them
 * using the same VenueList component used on the discovery page.
 *
 * Mirrors the original index.html renderSavedPage() pattern:
 * venues were already loaded in memory; saved IDs acted as a filter.
 */
export function SavedVenueList({ allVenues }: Props) {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSavedIds(getSavedVenueIds());
    setHydrated(true);

    // Sync when bookmarks change in other tabs (storage event fires cross-tab only)
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        setSavedIds(getSavedVenueIds());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Avoid flash: wait for localStorage read before rendering
  if (!hydrated) return null;

  const savedVenues = allVenues.filter((v) => savedIds.has(v.id));

  if (savedVenues.length === 0) {
    return (
      /* Empty state — matches original .empty-state: 🔖 icon, title, body, action */
      <div className="flex flex-col items-center justify-center text-center py-16 px-10">
        <div className="text-5xl opacity-50 mb-4">🔖</div>
        <p className="text-lg font-semibold text-gray-700 mb-2">
          No saved places yet
        </p>
        <p className="text-sm text-gray-500 mb-6">
          Tap the bookmark on a venue to save it here.
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
    <>
      <p className="text-sm font-semibold text-gray-700 mb-4">
        Saved Venues
      </p>
      <VenueList venues={savedVenues} />

      {/* TODO: SavedEventList goes here once saved-events phase is implemented */}
    </>
  );
}
