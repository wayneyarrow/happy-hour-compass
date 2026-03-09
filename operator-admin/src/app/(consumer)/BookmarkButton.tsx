"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "savedVenues";

function getSavedVenues(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function persistSavedVenues(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  // Notify same-tab listeners (storage event only fires cross-tab)
  window.dispatchEvent(new CustomEvent("hhc:savedChanged"));
}

type Props = {
  venueId: string;
  className?: string;
};

/**
 * Bookmark button that saves/unsaves a venue to localStorage.
 *
 * Reuses the original index.html pattern:
 * - Storage key: "savedVenues" (Set of venue IDs)
 * - SVG path matches original bookmark icon
 * - Unsaved: outline, gray-300 (#d1d5db)
 * - Saved: filled, orange-500 (#f97316)
 * - stopPropagation prevents parent <Link> from firing
 */
export function BookmarkButton({ venueId, className = "" }: Props) {
  const [saved, setSaved] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    setSaved(getSavedVenues().has(venueId));
  }, [venueId]);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ids = getSavedVenues();
    if (ids.has(venueId)) {
      ids.delete(venueId);
    } else {
      ids.add(venueId);
    }
    persistSavedVenues(ids);
    setSaved(ids.has(venueId));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={saved ? "Remove from saved" : "Save venue"}
      className={`flex items-center justify-center shrink-0 rounded-full transition-colors ${className}`}
      style={{ width: 28, height: 28, padding: 4 }}
    >
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          width: 18,
          height: 18,
          fill: saved ? "#f97316" : "none",
          stroke: saved ? "#f97316" : "#d1d5db",
          strokeWidth: 2,
          transition: "fill 0.2s, stroke 0.2s",
        }}
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
