"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Fixed bottom navigation for the consumer app.
 * Matches the original index.html bottom-nav structure:
 *   Search (🔍) | Events (🎉)
 */
export function ConsumerNav() {
  const pathname = usePathname();
  const isEvents = pathname.startsWith("/events");

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-50">
      <Link
        href="/"
        className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${
          !isEvents ? "text-blue-500" : "text-gray-400"
        }`}
      >
        {/* Search icon — matches original 🔍 tab */}
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
