"use client";

import { useRouter } from "next/navigation";

/**
 * Back button for the event detail header.
 *
 * Uses router.back() so the user returns to their actual previous page —
 * the events list, a collection, or wherever they came from — rather than
 * always hardcoding to /events.
 *
 * Falls back to /events if there is no navigation history in this session
 * (e.g. the user opened the event URL directly).
 */
export function EventBackButton() {
  const router = useRouter();

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/events");
    }
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      className="text-blue-500 text-2xl font-bold leading-none shrink-0"
      aria-label="Back"
    >
      ←
    </button>
  );
}
