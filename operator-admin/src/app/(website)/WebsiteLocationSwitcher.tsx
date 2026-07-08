"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { MARKETS, findNearestActiveMarket } from "@/lib/markets";
import { setMarketAction } from "@/app/(consumer)/marketActions";
import type { CityRecord } from "@/lib/geo/types";

type Props = {
  marketId: string;
  marketName: string;
  currentCityName: string;
  cities: CityRecord[];
};

export default function WebsiteLocationSwitcher({
  marketId,
  marketName,
  currentCityName,
  cities,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showRegions, setShowRegions] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [locating, setLocating] = useState(false);
  const [comingSoonId, setComingSoonId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowRegions(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setShowRegions(false);
    setComingSoonId(null);
  }

  function handleSelectRegion(market: (typeof MARKETS)[0]) {
    if (market.status === "coming_soon") {
      setComingSoonId((prev) => (prev === market.id ? null : market.id));
      return;
    }
    if (market.id === marketId) {
      close();
      return;
    }
    startTransition(async () => {
      await setMarketAction(market.id);
      router.refresh();
      close();
    });
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation || locating || isPending) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const nearest = findNearestActiveMarket(coords.latitude, coords.longitude);
        setLocating(false);
        startTransition(async () => {
          await setMarketAction(nearest.id);
          router.refresh();
          close();
        });
      },
      () => setLocating(false),
      { timeout: 8000 }
    );
  }

  // Other active cities in the same region (informational V1 — city-level
  // selection is not yet wired; cities are shown to communicate what's nearby).
  const otherCities = cities
    .filter((c) => c.status === "active" && c.name !== currentCityName)
    .slice(0, 6);

  const activeRegions = MARKETS.filter((m) => m.status === "active");
  const comingSoonRegions = MARKETS.filter((m) => m.status === "coming_soon");

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (open) setShowRegions(false);
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Browsing near ${currentCityName}. Tap to change location.`}
        className="
          flex items-center gap-1 sm:gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-[7px] rounded-full
          border border-gray-200 bg-white text-sm font-medium text-gray-800
          hover:bg-gray-50 hover:border-gray-300
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1
          transition-colors
        "
      >
        <span className="text-[13px] sm:text-[15px] leading-none" aria-hidden="true">📍</span>
        <span className="max-w-[80px] sm:max-w-[110px] truncate">{currentCityName}</span>
        <svg
          className={`w-2.5 h-2.5 sm:w-3 sm:h-3 text-gray-400 flex-shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Location switcher"
          className="
            absolute z-50
            right-0 sm:right-auto sm:left-0
            top-[calc(100%+6px)]
            w-72 max-w-[calc(100vw-24px)]
            bg-white rounded-2xl
            border border-gray-200
            shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]
            overflow-hidden
          "
        >
          {!showRegions ? (
            /* ── Location view ───────────────────────────────────────────── */
            <div className="p-4">
              {/* Current browsing location */}
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Browsing near
              </p>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-amber-500 text-lg flex-shrink-0" aria-hidden="true">📍</span>
                <span className="font-semibold text-gray-900">{currentCityName}</span>
              </div>
              <p className="text-xs text-gray-400 ml-7 mb-4">{marketName} region</p>

              {/* Other cities in this region — informational V1 */}
              {otherCities.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
                    Also in this region
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {otherCities.map((c) => (
                      <span
                        key={c.id}
                        className="inline-block px-2.5 py-1 rounded-full text-xs bg-gray-50 border border-gray-100 text-gray-500"
                      >
                        {c.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-gray-100 mb-3" />

              {/* Change region */}
              <button
                type="button"
                onClick={() => setShowRegions(true)}
                className="
                  w-full flex items-center justify-between
                  px-3 py-2 rounded-xl
                  text-sm font-medium text-gray-700
                  hover:bg-gray-50 transition-colors
                "
              >
                <span>Change Region</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          ) : (
            /* ── Region picker view ──────────────────────────────────────── */
            <div className="p-4">
              {/* Back */}
              <button
                type="button"
                onClick={() => {
                  setShowRegions(false);
                  setComingSoonId(null);
                }}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
                Choose a Region
              </p>

              {/* Use My Location */}
              <button
                type="button"
                onClick={handleUseMyLocation}
                disabled={isPending || locating}
                className="
                  w-full flex items-center gap-2 px-3 py-2.5 mb-3
                  rounded-xl text-sm font-semibold
                  bg-blue-50 text-blue-600
                  hover:bg-blue-100 disabled:opacity-50 disabled:cursor-default
                  transition-colors
                "
              >
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
                {locating ? "Detecting location…" : "Use My Location"}
              </button>

              {/* Active regions */}
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Active regions
              </p>
              <div className="flex flex-col gap-1 mb-3">
                {activeRegions.map((m) => {
                  const isSelected = m.id === marketId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelectRegion(m)}
                      disabled={isPending}
                      className={`
                        w-full flex items-center justify-between
                        px-3 py-2.5 rounded-xl text-sm font-medium
                        transition-colors disabled:cursor-default
                        ${isSelected
                          ? "bg-green-50 text-green-800"
                          : "text-gray-700 hover:bg-gray-50"
                        }
                      `}
                    >
                      {m.name}
                      {isSelected && (
                        <svg
                          className="w-4 h-4 text-green-600 flex-shrink-0"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                          aria-hidden="true"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414L8.414 15l-4.121-4.121a1 1 0 011.414-1.414L8.414 12.172l7.879-7.879a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Coming soon regions */}
              {comingSoonRegions.length > 0 && (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
                    Coming soon
                  </p>
                  <div className="flex flex-col gap-1">
                    {comingSoonRegions.map((m) => (
                      <div key={m.id}>
                        <button
                          type="button"
                          onClick={() => handleSelectRegion(m)}
                          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:bg-gray-50 transition-colors"
                        >
                          {m.name}
                          <span className="text-[10px] bg-gray-100 text-gray-400 rounded-md px-2 py-0.5 font-semibold flex-shrink-0">
                            Soon
                          </span>
                        </button>
                        {comingSoonId === m.id && (
                          <p className="text-xs text-gray-400 px-3 pb-1.5">
                            {m.name} is coming soon — stay tuned!
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
