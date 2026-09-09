"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Market } from "@/lib/markets";
import { findNearestActiveMarket } from "@/lib/markets";
import { setMarketAction } from "@/app/(consumer)/marketActions";
import { HeroDiscoverySearch } from "./HeroDiscoverySearch";
import { trackGA4Event } from "@/lib/ga4";
import {
  DISCOVERY_MODE_ORDER,
  DISCOVERY_MODES,
  DEFAULT_DISCOVERY_MODE,
  type DiscoveryMode,
} from "@/lib/homepageDiscoveryModes";

type Props = {
  market: Market;
  isPersisted: boolean;
  /**
   * Whether the Daily Specials selector option should show its "NEW"
   * badge — computed server-side via isFeatureNewBadgeVisible() and passed
   * down as a plain boolean so this Client Component never calls
   * `new Date()` itself during render (see newBadge.ts's header comment on
   * why that avoids a hydration mismatch right at the expiry boundary).
   */
  dailySpecialsNewBadgeVisible: boolean;
};

export default function HeroSection({ market, isPersisted, dailySpecialsNewBadgeVisible }: Props) {
  const router = useRouter();
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>(DEFAULT_DISCOVERY_MODE);
  const [, startTransition] = useTransition();

  const activeConfig = DISCOVERY_MODES[discoveryMode];

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

  // GA4 homepage_discovery_mode_selected — fires only for a genuine change
  // away from the current mode: never for the Happy Hours default on page
  // load (there's no call at mount) and never for re-clicking the
  // already-active mode (the `mode !== discoveryMode` guard below).
  function selectDiscoveryMode(mode: DiscoveryMode) {
    if (mode !== discoveryMode) {
      trackGA4Event("homepage_discovery_mode_selected", {
        surface: "homepage_hero",
        mode,
        previous_mode: discoveryMode,
        market: market.id,
      });
    }
    setDiscoveryMode(mode);
  }

  function trackBrowseClick() {
    trackGA4Event("homepage_discovery_browse_clicked", {
      surface: "homepage_hero",
      mode: discoveryMode,
      market: market.id,
    });
  }

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

      {/* Subheadline */}
      <p className="mt-5 text-lg md:text-xl text-gray-400">
        Discover happy hours, daily specials and events near you.
      </p>

      {/* Happy Hours / Daily Specials / Events segmented control */}
      <div className="mt-5 w-full max-w-md">
        <div className="bg-gray-100 rounded-full p-1 flex" role="group" aria-label="Discovery mode">
          {DISCOVERY_MODE_ORDER.map((mode) => {
            const config = DISCOVERY_MODES[mode];
            const isActive = mode === discoveryMode;
            const showNewBadge = mode === "daily_specials" && dailySpecialsNewBadgeVisible;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => selectDiscoveryMode(mode)}
                aria-pressed={isActive}
                className={`
                  flex-1 flex items-center justify-center gap-1
                  py-2 px-2 sm:px-4 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap
                  transition-all duration-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400
                  ${isActive
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                  }
                `}
              >
                <span>{config.label}</span>
                {showNewBadge && (
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold leading-none text-amber-700"
                  >
                    NEW
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Primary CTA — Browse */}
      <div className="mt-6 w-full max-w-xl">
        <Link
          href={activeConfig.destination}
          onClick={trackBrowseClick}
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
          {activeConfig.ctaLabel}
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

      {/* Search pill — secondary action. Searches the entity that matches
          the selected mode (venues / Daily Specials / Events — see
          HeroDiscoverySearch.tsx) and derives its own placeholder, CTA
          copy, and "See all" destination from DISCOVERY_MODES for the
          given mode. */}
      <HeroDiscoverySearch market={market} mode={discoveryMode} />

    </section>
  );
}
