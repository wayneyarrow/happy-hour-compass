"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Fixed bottom navigation for the consumer app.
 * Matches the original index.html bottom-nav structure:
 *   Search (🔍) | Saved (bookmark) | Events (🎉)
 */
export function ConsumerNav() {
  const pathname = usePathname();
  const isSearch = pathname === "/" || pathname.startsWith("/venue");
  const isSaved = pathname.startsWith("/saved");
  const isEvents =
    pathname.startsWith("/events") || pathname.startsWith("/event");

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-50">
      {/* Search tab */}
      <Link
        href="/"
        className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${
          isSearch ? "text-blue-500" : "text-gray-400"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5 mb-1"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        Search
      </Link>

      {/* Saved tab — bookmark icon, matches original nav */}
      <Link
        href="/saved"
        className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${
          isSaved ? "text-blue-500" : "text-gray-400"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="w-5 h-5 mb-1"
        >
          <path
            d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
            stroke={isSaved ? "#3b82f6" : "#9ca3af"}
            fill={isSaved ? "#3b82f6" : "none"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Saved
      </Link>

      {/* Events tab */}
      <Link
        href="/events"
        className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${
          isEvents ? "text-blue-500" : "text-gray-400"
        }`}
      >
        <span className="text-xl leading-none mb-1">🎉</span>
        Events
      </Link>
    </nav>
  );
}
