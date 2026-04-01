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
  /**
   * "list"   — compact row size: 28×28px button, 18px SVG, gray-300 default stroke.
   *            Used in venue card list rows.
   * "header" — header tap-target size: 44×44px min button, 22px SVG, gray-500 default
   *            stroke, hover background. Matches original .header-icon-btn sizing.
   */
  variant?: "list" | "header";
};

/**
 * Bookmark button that saves/unsaves a venue to localStorage.
 *
 * Reuses the original index.html pattern:
 * - Storage key: "savedVenues" (Set of venue IDs)
 * - SVG path matches original bookmark icon
 * - Unsaved: outline, gray-300 (#d1d5db) / gray-500 in header variant
 * - Saved: filled, orange-500 (#f97316)
 * - stopPropagation prevents parent <Link> from firing
 */
export function BookmarkButton({ venueId, className = "", variant = "list" }: Props) {
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

  const isHeader = variant === "header";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={saved ? "Remove from saved" : "Save venue"}
      className={`flex items-center justify-center shrink-0 rounded-full transition-colors ${isHeader ? "hover:bg-gray-100" : ""} ${className}`}
      style={
        isHeader
          ? { minWidth: 44, minHeight: 44, padding: 8 }
          : { width: 28, height: 28, padding: 4 }
      }
    >
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          width: isHeader ? 22 : 18,
          height: isHeader ? 22 : 18,
          fill: saved ? "#f97316" : "none",
          stroke: saved ? "#f97316" : isHeader ? "#6b7280" : "#d1d5db",
          strokeWidth: 2,
          transition: "fill 0.2s, stroke 0.2s",
        }}
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
