"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { haversineKm } from "@/lib/geo";
import { computeHhStatus } from "@/lib/happyHourStatus";
import { SearchResultCard, type SearchResultCardData } from "./SearchResultCard";
import SearchContextHeader from "./SearchContextHeader";
import type { Market } from "@/lib/markets";

// ─── Extended card type ───────────────────────────────────────────────────────

/**
 * SearchResultCardData extended with fields needed for client-side filtering
 * and distance calculation. Page.tsx constructs this from ConsumerVenue.
 */
export type WebsiteVenueCard = SearchResultCardData & {
  latitude: number | null;
  longitude: number | null;
  happyHourWeekly: Record<string, Array<{ start: string; end: string }>>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const NEAR_ME_RADIUS_KM = 25;
const TOP_RATED_MIN = 4.0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true if the venue has happy hour at the given "HH:MM" time on any day. */
function hasHappyHourAtTime(
  weekly: Record<string, Array<{ start: string; end: string }>>,
  hhMm: string
): boolean {
  const [h, m] = hhMm.split(":").map(Number);
  const check = h * 60 + (m || 0);
  return Object.values(weekly).some((slots) =>
    slots.some((slot) => {
      const [sh, sm] = slot.start.split(":").map(Number);
      const start = sh * 60 + (sm || 0);
      const end =
        slot.end === "close"
          ? 1440
          : (() => {
              const [eh, em] = slot.end.split(":").map(Number);
              return eh * 60 + (em || 0);
            })();
      return check >= start && check < end;
    })
  );
}

function formatTimeDisplay(hhMm: string): string {
  const [h, m] = hhMm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}:${String(m).padStart(2, "0")} ${period}`;
}

// ─── Sort options ─────────────────────────────────────────────────────────────

type SortOption = "distance" | "rating" | "az";

// ─── Chip button ──────────────────────────────────────────────────────────────

function ChipButton({
  label,
  active,
  onClick,
  hasArrow = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  hasArrow?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2",
        "border rounded-full text-sm font-medium whitespace-nowrap",
        "transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
        active
          ? "bg-gray-900 border-gray-900 text-white"
          : "bg-white border-gray-200 text-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-gray-300 hover:bg-gray-50",
      ].join(" ")}
    >
      {label}
      {hasArrow && (
        <svg
          className="w-3 h-3 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      )}
    </button>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  anyFilter,
  onClear,
}: {
  anyFilter: boolean;
  onClear: () => void;
}) {
  return (
    <div className="text-center py-16">
      <p className="text-sm font-semibold text-gray-500">No venues found</p>
      {anyFilter ? (
        <>
          <p className="text-xs text-gray-400 mt-1">Try adjusting your filters.</p>
          <button
            type="button"
            onClick={onClear}
            className="mt-4 text-sm text-amber-600 hover:text-amber-700 font-medium underline"
          >
            Clear all filters
          </button>
        </>
      ) : (
        <p className="text-xs text-gray-400 mt-1">
          Try switching to a different market.
        </p>
      )}
    </div>
  );
}

// ─── Map placeholder ──────────────────────────────────────────────────────────

function MapPlaceholder() {
  return (
    <div className="text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-white mx-auto flex items-center justify-center mb-4 shadow-sm">
        <svg
          className="w-8 h-8 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
          />
        </svg>
      </div>
      <p className="text-sm font-semibold text-gray-600">Interactive Map Placeholder</p>
      <p className="text-xs text-gray-400 mt-1">Google Maps integration coming soon</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  cards: WebsiteVenueCard[];
  market: Market;
};

export function HappyHoursSearchClient({ cards, market }: Props) {
  // ── filter state ──
  const [nearMeActive, setNearMeActive] = useState(false);
  const [onNowActive, setOnNowActive] = useState(false);
  const [topRatedActive, setTopRatedActive] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [filterTime, setFilterTime] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("distance");

  // ── dropdown open state ──
  const [typeOpen, setTypeOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);

  // ── geo state ──
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "requesting" | "granted" | "denied"
  >("idle");

  // ── dropdown refs for click-outside ──
  const typeRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  // Request geolocation on mount — same auto-request pattern as VenueList.tsx.
  // When granted, the default "distance" sort activates and cards are sorted nearest-first.
  useEffect(() => {
    if (!navigator?.geolocation) {
      setLocationStatus("denied");
      return;
    }
    setLocationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserLocation({ lat: coords.latitude, lng: coords.longitude });
        setLocationStatus("granted");
      },
      () => setLocationStatus("denied"),
      { timeout: 8000, maximumAge: 60_000 }
    );
  }, []);

  // Click-outside close for all dropdowns in one listener.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (typeOpen && typeRef.current && !typeRef.current.contains(t))
        setTypeOpen(false);
      if (sortOpen && sortRef.current && !sortRef.current.contains(t))
        setSortOpen(false);
      if (timeOpen && timeRef.current && !timeRef.current.contains(t))
        setTimeOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [typeOpen, sortOpen, timeOpen]);

  // ── derived data ──

  const establishmentTypes = useMemo(
    () =>
      Array.from(
        new Set(cards.map((c) => c.establishmentType).filter(Boolean))
      ).sort(),
    [cards]
  );

  // ── filter (live: On Now uses computeHhStatus so it reflects actual wall-clock time) ──
  const filteredCards = useMemo(() => {
    const hasLoc = userLocation !== null;
    return cards.filter((card) => {
      if (onNowActive && computeHhStatus(card.happyHourWeekly).type !== "active")
        return false;
      if (
        nearMeActive &&
        hasLoc &&
        card.latitude !== null &&
        card.longitude !== null
      ) {
        if (
          haversineKm(
            userLocation.lat,
            userLocation.lng,
            card.latitude,
            card.longitude
          ) > NEAR_ME_RADIUS_KM
        )
          return false;
      }
      if (
        topRatedActive &&
        (card.googleRating === null || card.googleRating < TOP_RATED_MIN)
      )
        return false;
      if (selectedType && card.establishmentType !== selectedType) return false;
      if (filterTime && !hasHappyHourAtTime(card.happyHourWeekly, filterTime))
        return false;
      return true;
    });
  }, [
    cards,
    onNowActive,
    nearMeActive,
    userLocation,
    topRatedActive,
    selectedType,
    filterTime,
  ]);

  // ── sort + enrich with real distances ──
  // sortBy is used directly. "distance" without location returns 0 (stable: preserves
  // server ordering) rather than falling back to rating — this ensures switching
  // between "Nearest" and "Top Rated First" always produces a visibly different result.
  const sortedCards = useMemo(() => {
    const hasLoc = userLocation !== null;

    const withDist = filteredCards.map((card) => ({
      ...card,
      distanceKm:
        hasLoc && card.latitude !== null && card.longitude !== null
          ? haversineKm(
              userLocation!.lat,
              userLocation!.lng,
              card.latitude,
              card.longitude
            )
          : null,
    }));

    return [...withDist].sort((a, b) => {
      if (sortBy === "distance") {
        if (!hasLoc) return 0; // stable: preserve server ordering until location granted
        if (a.distanceKm === null && b.distanceKm === null) return 0;
        if (a.distanceKm === null) return 1;
        if (b.distanceKm === null) return -1;
        return a.distanceKm - b.distanceKm;
      }
      if (sortBy === "rating") {
        return (b.googleRating ?? -1) - (a.googleRating ?? -1);
      }
      return a.name.localeCompare(b.name);
    });
  }, [filteredCards, userLocation, sortBy]);

  // ── handlers ──

  function handleNearMe() {
    if (nearMeActive) {
      setNearMeActive(false);
      return;
    }
    // Don't activate if browser denied permission.
    if (locationStatus === "denied") return;
    setNearMeActive(true);
  }

  function clearAllFilters() {
    setNearMeActive(false);
    setOnNowActive(false);
    setTopRatedActive(false);
    setSelectedType(null);
    setFilterTime("");
  }

  // ── chip labels ──

  const hasLoc = userLocation !== null;
  const sortLabel =
    sortBy === "distance" ? "Nearest" : sortBy === "rating" ? "Top Rated" : "A-Z";
  const typeLabel = selectedType ?? "Type";
  const timeLabel = filterTime
    ? `Time: ${formatTimeDisplay(filterTime)}`
    : "Time";

  const anyFilter =
    nearMeActive || onNowActive || topRatedActive || !!selectedType || !!filterTime;

  // ─── render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Sticky filter chip bar ─────────────────────────────────────────── */}
      <div className="sticky top-16 md:top-[72px] z-20 bg-white border-b border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-2 px-4 md:px-6 py-3 overflow-x-auto">

          {/* Near Me */}
          <ChipButton
            label="Near Me"
            active={nearMeActive}
            onClick={handleNearMe}
          />

          {/* On Now */}
          <ChipButton
            label="On Now"
            active={onNowActive}
            onClick={() => setOnNowActive((v) => !v)}
          />

          {/* Time */}
          <div ref={timeRef} className="relative flex-shrink-0">
            <ChipButton
              label={timeLabel}
              active={!!filterTime || timeOpen}
              onClick={() => setTimeOpen((v) => !v)}
              hasArrow
            />
            {timeOpen && (
              <div className="absolute top-full mt-2 left-0 z-30 bg-white rounded-2xl border border-gray-200 shadow-xl p-4 w-56">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Happy hour at
                </p>
                <input
                  type="time"
                  value={filterTime}
                  onChange={(e) => setFilterTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
                />
                <p className="mt-2 text-xs text-gray-400 leading-tight">
                  Shows venues with happy hour at this time on any day
                </p>
                {filterTime && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterTime("");
                      setTimeOpen(false);
                    }}
                    className="mt-2 text-xs text-gray-500 hover:text-gray-800 underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Top Rated */}
          <ChipButton
            label="Top Rated"
            active={topRatedActive}
            onClick={() => setTopRatedActive((v) => !v)}
          />

          {/* Type */}
          <div ref={typeRef} className="relative flex-shrink-0">
            <ChipButton
              label={typeLabel}
              active={!!selectedType || typeOpen}
              onClick={() => setTypeOpen((v) => !v)}
              hasArrow
            />
            {typeOpen && (
              <div className="absolute top-full mt-2 left-0 z-30 bg-white rounded-2xl border border-gray-200 shadow-xl py-2 min-w-[180px]">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedType(null);
                    setTypeOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                    !selectedType ? "font-semibold text-gray-900" : "text-gray-700"
                  }`}
                >
                  All Types
                </button>
                {establishmentTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setSelectedType(type);
                      setTypeOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                      selectedType === type
                        ? "font-semibold text-gray-900"
                        : "text-gray-700"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sort */}
          <div ref={sortRef} className="relative flex-shrink-0">
            <ChipButton
              label={`Sort: ${sortLabel}`}
              active={sortOpen}
              onClick={() => setSortOpen((v) => !v)}
              hasArrow
            />
            {sortOpen && (
              <div className="absolute top-full mt-2 right-0 z-30 bg-white rounded-2xl border border-gray-200 shadow-xl py-2 min-w-[200px]">
                <button
                  type="button"
                  onClick={() => {
                    setSortBy("distance");
                    setSortOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                    sortBy === "distance" ? "font-semibold text-gray-900" : "text-gray-700"
                  }`}
                >
                  <span>Nearest First</span>
                  {!hasLoc && (
                    <span className="block text-xs text-gray-400 font-normal mt-0.5">
                      Enable location to activate
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSortBy("rating");
                    setSortOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                    sortBy === "rating" ? "font-semibold text-gray-900" : "text-gray-700"
                  }`}
                >
                  Top Rated First
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSortBy("az");
                    setSortOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                    sortBy === "az" ? "font-semibold text-gray-900" : "text-gray-700"
                  }`}
                >
                  A – Z
                </button>
              </div>
            )}
          </div>

          {/* Clear all — appears when any filter is active */}
          {anyFilter && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-800 whitespace-nowrap transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Clear
            </button>
          )}
        </div>

        {/* Location denied hint — only shown when Near Me was activated but denied */}
        {nearMeActive && locationStatus === "denied" && (
          <p className="px-4 md:px-6 pb-2.5 text-xs text-amber-700">
            Enable location access in your browser settings to use Near Me.
          </p>
        )}
      </div>

      {/* ── Desktop: 50/50 split ──────────────────────────────────────────────── */}
      <div className="hidden md:flex">
        {/* Results column — scrolls with the page */}
        <div className="w-1/2 min-h-[calc(100dvh-72px)] border-r border-gray-100 px-5 pt-8 pb-10">
          <SearchContextHeader
            market={market}
            resultCount={sortedCards.length}
            className="mb-7"
          />

          {sortedCards.length === 0 ? (
            <EmptyState anyFilter={anyFilter} onClear={clearAllFilters} />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {sortedCards.map((card) => (
                <SearchResultCard key={card.id} data={card} />
              ))}
            </div>
          )}
        </div>

        {/* Map column — sticky within viewport */}
        <div className="w-1/2">
          <div
            className="sticky top-[132px] flex p-4"
            style={{ height: "calc(100dvh - 132px)" }}
          >
            <div className="flex-1 rounded-2xl bg-gray-100 flex items-center justify-center overflow-hidden">
              <MapPlaceholder />
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile: stacked layout ────────────────────────────────────────────── */}
      <div className="md:hidden">
        <SearchContextHeader
          market={market}
          resultCount={sortedCards.length}
          className="px-4 pt-6 pb-5 border-b border-gray-100"
        />

        <div className="mx-4 my-4 h-52 rounded-2xl bg-gray-100 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-500">Interactive Map Placeholder</p>
            <p className="text-xs text-gray-400 mt-1">Coming soon</p>
          </div>
        </div>

        {sortedCards.length === 0 ? (
          <div className="px-4 pb-8">
            <EmptyState anyFilter={anyFilter} onClear={clearAllFilters} />
          </div>
        ) : (
          <div className="px-4 pb-8 space-y-4">
            {sortedCards.map((card) => (
              <SearchResultCard key={card.id} data={card} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
