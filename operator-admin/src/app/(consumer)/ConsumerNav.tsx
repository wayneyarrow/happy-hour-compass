"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ConsumerNav() {
  const pathname = usePathname();
  const isHome =
    pathname === "/" || pathname.startsWith("/home");
  const isSearch =
    pathname.startsWith("/explore") || pathname.startsWith("/venue");
  const isSaved = pathname.startsWith("/saved");
  const isEvents =
    pathname.startsWith("/events") || pathname.startsWith("/event");
  const isMore = pathname.startsWith("/suggest");

  const activeClass = "text-blue-500";
  const inactiveClass = "text-gray-400";

  return (
    <nav className="bg-white border-t border-gray-200 flex shrink-0">
      {/* Home */}
      <Link
        href="/"
        className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${
          isHome ? activeClass : inactiveClass
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
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        Home
      </Link>

      {/* Search */}
      <Link
        href="/explore"
        className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${
          isSearch ? activeClass : inactiveClass
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

      {/* Saved */}
      <Link
        href="/saved"
        className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${
          isSaved ? activeClass : inactiveClass
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
          <path
            d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
            fill={isSaved ? "currentColor" : "none"}
          />
        </svg>
        Saved
      </Link>

      {/* Events — Ticket icon */}
      <Link
        href="/events"
        className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${
          isEvents ? activeClass : inactiveClass
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
          <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z" />
          <line x1="9" y1="9" x2="9" y2="15" strokeDasharray="2 2" />
        </svg>
        Events
      </Link>

      {/* More — Ellipsis icon */}
      <Link
        href="/suggest"
        className={`flex-1 flex flex-col items-center py-3 text-xs font-medium transition-colors ${
          isMore ? activeClass : inactiveClass
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
          <circle cx="5" cy="12" r="1" fill="currentColor" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
          <circle cx="19" cy="12" r="1" fill="currentColor" />
        </svg>
        More
      </Link>
    </nav>
  );
}
