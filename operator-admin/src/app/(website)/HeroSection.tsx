"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Market } from "@/lib/markets";
import { findNearestActiveMarket } from "@/lib/markets";
import { setMarketAction } from "@/app/(consumer)/marketActions";
import { HeroVenueSearch } from "./HeroVenueSearch";

type ContentType = "happy-hours" | "events";

type Props = {
  market: Market;
  cityName: string;
  isPersisted: boolean;
};

export default function HeroSection({ market, cityName, isPersisted }: Props) {
  const router = useRouter();
  const [contentType, setContentType] = useState<ContentType>("happy-hours");
  const [, startTransition] = useTransition();

  const subheadline =
    contentType === "happy-hours"
      ? "Discover the best happy hours near you."
      : "Discover what's happening near you.";

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
      ? "Search venues, food and drink specials..."
      : `Search ${cityName} events or venues...`;

  return (
    <section
      aria-label="Hero"
      className="flex flex-col items-center text-center px-6
                 pt-16 md:pt-20
                 min-h-[460px] md:min-h-[calc(100dvh-260px)]"
    >
      {/* Headline */}
      <h1 className="text-gray-900 tracking-tight max-w-4xl">
        <span className="block text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.1]">
          Never ask
        </span>
        <span className="block text-[2.75rem] sm:text-6xl md:text-7xl font-extrabold leading-[1.05] my-0.5 md:my-1">
          &ldquo;Where should we go?&rdquo;
        </span>
        <span className="block text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.1]">
          again.
        </span>
      </h1>

      {/* Subheadline — tied to the Happy Hours / Events toggle */}
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
          {contentType === "happy-hours" ? "Browse Happy Hours" : "Show Me Events"}
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

      {/* Search pill — secondary action, wired to live venue suggestions.
          discoveryHref is only set for Happy Hours: /website-events has no
          ?q=-aware search results page yet, so Events mode stays
          venue-suggestions-only rather than linking somewhere that can't
          apply the query. */}
      <HeroVenueSearch
        market={market}
        placeholder={searchPlaceholder}
        ariaLabel={`Search ${contentType === "happy-hours" ? "happy hours" : "events"}`}
        discoveryHref={contentType === "happy-hours" ? "/website-happy-hours" : undefined}
      />

    </section>
  );
}
