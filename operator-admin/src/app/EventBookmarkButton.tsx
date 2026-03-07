"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "savedEvents";

function getSavedEvents(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function persistSavedEvents(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  // Notify same-tab listeners (storage event only fires cross-tab)
  window.dispatchEvent(new CustomEvent("hhc:savedChanged"));
}

type Props = {
  eventId: string;
  className?: string;
};

/**
 * Bookmark button for saving/unsaving individual events to localStorage.
 *
 * Mirrors the original index.html pattern for savedEvents (separate Set from savedVenues).
 * - Storage key: "savedEvents" (Set of event IDs)
 * - Same SVG path and colors as BookmarkButton
 * - Dispatches "hhc:savedChanged" custom event so the Saved page
 *   can update immediately in the same tab
 */
export function EventBookmarkButton({ eventId, className = "" }: Props) {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(getSavedEvents().has(eventId));
  }, [eventId]);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ids = getSavedEvents();
    if (ids.has(eventId)) {
      ids.delete(eventId);
    } else {
      ids.add(eventId);
    }
    persistSavedEvents(ids);
    setSaved(ids.has(eventId));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={saved ? "Remove from saved" : "Save event"}
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
