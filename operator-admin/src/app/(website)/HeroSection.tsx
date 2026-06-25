"use client";

import { useState, useEffect } from "react";

export default function HeroSection() {
  const [subheadline, setSubheadline] = useState("Find the best happy hour.");

  // Runs only on the client so the time reflects the user's local timezone.
  // Falls back to the neutral string rendered by the server.
  useEffect(() => {
    const hour = new Date().getHours();
    setSubheadline(
      hour >= 17
        ? "Find tonight’s best happy hour."
        : "Find today’s best happy hour."
    );
  }, []);

  return (
    <section
      aria-label="Hero"
      className="flex flex-col items-center text-center px-6
                 pt-24 md:pt-32
                 min-h-[540px] md:min-h-[calc(100dvh-128px)]"
    >
      {/* Headline */}
      <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-gray-900 tracking-tight leading-[1.08] max-w-2xl">
        Never ask &ldquo;Where should we go?&rdquo; again.
      </h1>

      {/* Subheadline — time-based, hydrates immediately after mount */}
      <p className="mt-5 text-lg md:text-xl text-gray-400">
        {subheadline}
      </p>

      {/* Search bar — presentation only; search logic wired up in a future task */}
      <div className="mt-10 w-full max-w-xl">
        <button
          type="button"
          aria-label="Search happy hours and events"
          className="
            w-full flex items-center gap-3 pl-5 pr-5 py-[18px]
            bg-white border border-gray-200 rounded-full text-left cursor-pointer
            shadow-[0_4px_20px_rgba(0,0,0,0.10),0_1px_6px_rgba(0,0,0,0.06)]
            hover:shadow-[0_8px_32px_rgba(0,0,0,0.14),0_2px_10px_rgba(0,0,0,0.08)]
            hover:border-gray-300
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2
            transition-all duration-200
          "
        >
          {/* Search icon */}
          <svg
            className="w-5 h-5 text-amber-500 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>

          {/* Placeholder text */}
          <span className="flex-1 text-[15px] text-gray-400">
            Search happy hours and events...
          </span>
        </button>
      </div>
    </section>
  );
}
