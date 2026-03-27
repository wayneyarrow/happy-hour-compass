"use client";

import { useRouter } from "next/navigation";

/**
 * Back button for the venue detail header.
 * Uses router.back() so the user returns to their actual previous location
 * (e.g. scrolled venue list, map view) rather than always resetting to /.
 * Falls back to / if there is no navigation history in this session.
 */
export function BackButton() {
  const router = useRouter();

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      className="text-blue-500 text-2xl font-bold leading-none shrink-0"
      aria-label="Back to venues"
    >
      ←
    </button>
  );
}
