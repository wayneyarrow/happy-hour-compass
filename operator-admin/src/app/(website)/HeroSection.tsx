"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Market } from "@/lib/markets";
import { findNearestActiveMarket } from "@/lib/markets";
import { setMarketAction } from "@/app/(consumer)/marketActions";

type ContentType = "happy-hours" | "events";

type Props = {
  market: Market;
  isPersisted: boolean;
};

export default function HeroSection({ market, isPersisted }: Props) {
  const router = useRouter();
  const [isEvening, setIsEvening] = useState(false);
  const [contentType, setContentType] = useState<ContentType>("happy-hours");
  const [, startTransition] = useTransition();

  // Detect time of day client-side so it reflects the user's local timezone.
  useEffect(() => {
    setIsEvening(new Date().getHours() >= 17);
  }, []);

  const subheadline =
    contentType === "happy-hours"
      ? isEvening ? "Find tonight's best happy hour." : "Find today's best happy hour."
      : isEvening ? "Discover tonight's events." : "Discover today's events.";

  // Auto-detect market on first visit when no cookie is set.
  // Reuses the same findNearestActiveMarket + setMarketAction as MarketChip.
  useEffect(() => {
    if (isPersisted) return;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const nearest = findNearestActiveMarket(coords.latitude, coords.longitude);
        startTransition(async () => {
          await setMarketAction(nearest.id);
          if (nearest.id !== market.id) {
            router.refresh();
          }
        });
      },
      () => {},
      { timeout: 5000, maximumAge: 60_000 }
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showMeHref = contentType === "happy-hours" ? "/website-happy-hours" : "/website-events";
  const searchPlaceholder =
    contentType === "happy-hours"
      ? "Search for a venue or neighbourhood..."
      : "Search for an event, venue or neighbourhood...";

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

      {/* Happy Hours / Events segmented control */}
      <div className="mt-5 w-full max-w-[280px]">
        <div className="bg-gray-100 rounded-full p-1 flex" role="group" aria-label="Content type">
          <button
            type="button"
            onClick={() => setContentType("happy-hours")}
            aria-pressed={contentType === "happy-hours"}
            className={`
              flex-1 py-2 px-4 rounded-full text-sm font-medium transition-all duration-200
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400
              ${contentType === "happy-hours"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
              }
            `}
          >
            Happy Hours
          </button>
          <button
            type="button"
            onClick={() => setContentType("events")}
            aria-pressed={contentType === "events"}
            className={`
              flex-1 py-2 px-4 rounded-full text-sm font-medium transition-all duration-200
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400
              ${contentType === "events"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
              }
            `}
          >
            Events
          </button>
        </div>
      </div>

      {/* Primary CTA — Show Me */}
      <div className="mt-6 w-full max-w-xl">
        <Link
          href={showMeHref}
          className="
            w-full flex items-center justify-center gap-2
            px-6 py-[18px]
            bg-amber-500 hover:bg-amber-600 active:bg-amber-700
            text-white font-bold text-base
            rounded-full
            shadow-[0_4px_20px_rgba(245,158,11,0.30),0_1px_6px_rgba(245,158,11,0.18)]
            hover:shadow-[0_8px_32px_rgba(245,158,11,0.40),0_2px_10px_rgba(245,158,11,0.25)]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2
            transition-all duration-200
          "
        >
          {contentType === "happy-hours" ? "Show Me Happy Hours" : "Show Me Events"}
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </Link>
      </div>

      {/* Search pill — secondary action */}
      <div className="mt-3 w-full max-w-xl">
        <button
          type="button"
          aria-label={`Search ${contentType === "happy-hours" ? "happy hours" : "events"}`}
          className="
            w-full flex items-center gap-3 pl-5 pr-5 py-[14px]
            bg-white border border-gray-200 rounded-full text-left cursor-pointer
            shadow-[0_2px_12px_rgba(0,0,0,0.07),0_1px_4px_rgba(0,0,0,0.04)]
            hover:shadow-[0_4px_20px_rgba(0,0,0,0.10),0_2px_8px_rgba(0,0,0,0.06)]
            hover:border-gray-300
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2
            transition-all duration-200
          "
        >
          <svg
            className="w-4 h-4 text-gray-400 flex-shrink-0"
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
          <span className="flex-1 text-[14px] text-gray-400">
            {searchPlaceholder}
          </span>
        </button>
      </div>

    </section>
  );
}
