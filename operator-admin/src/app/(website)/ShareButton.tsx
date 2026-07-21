"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /**
   * Absolute canonical URL to share. Callers are responsible for building
   * this from a canonical-path helper (e.g. buildVenuePublicPath()) composed
   * with absoluteUrl() — never window.location.href — so preview/query/hash
   * state and non-production hosts can never leak into a shared link.
   */
  url: string;
  /** Content-type-specific accessible label, e.g. "Share venue" | "Share event" | "Share guide". */
  label: string;
};

/**
 * Native share button, reused across the Venue, Event, and Guide detail
 * pages (replaces the old per-route (consumer) ShareButton).
 *
 * Behaviour:
 *   1. navigator.share() when available. A cancelled or failed native share
 *      is left alone (matches the platform's own share-sheet UX) — no
 *      clipboard fallback is attempted once the user has engaged the native
 *      sheet, since the browser has already presented its own affordance.
 *   2. Otherwise, copies the URL to the clipboard and shows a brief
 *      "Copied!" confirmation.
 *   3. Clipboard failure is caught silently — never throws a visible error.
 */
export function ShareButton({ url, label }: Props) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ url }).catch(() => {});
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context, unsupported
      // browser, etc.) — a share action must never surface a visible error.
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={handleShare}
        aria-label={label}
        className="flex items-center justify-center shrink-0 rounded-full hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1"
        style={{ minWidth: 44, minHeight: 44, padding: 8 }}
      >
        <svg
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          style={{ width: 22, height: 22, fill: "#374151" }}
        >
          <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" />
        </svg>
      </button>
      {copied && (
        <span
          role="status"
          aria-live="polite"
          className="absolute -bottom-8 right-0 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-sm z-10"
        >
          Copied!
        </span>
      )}
    </span>
  );
}
