"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { haversineKm } from "@/lib/geo";
import { computeHhStatus } from "@/lib/happyHourStatus";
import { matchVenueSearchTier } from "@/lib/data/venueSearch";
import { SearchResultCard, type SearchResultCardData } from "./SearchResultCard";
import SearchContextHeader from "./SearchContextHeader";
import { SearchResultsMap, type MapMarker } from "../SearchResultsMap";
import type { Market } from "@/lib/markets";

// ─── Extended card type ───────────────────────────────────────────────────────

/**
 * SearchResultCardData extended with fields needed for client-side filtering
 * and distance calculation. Page.tsx constructs this from ConsumerVenue.
 *
 * city/seededTags/searchTags/specialsFood/specialsDrinks power free-text
 * search (see matchVenueSearchTier, src/lib/data/venueSearch.ts) and are
 * optional: only website-happy-hours/page.tsx (enableSearch=true) supplies
 * them today. Other WebsiteVenueCard construction sites (Collections,
 * Saved) are unaffected — a card missing these just never matches on those
 * tiers, which is moot anyway since search is off for those callers.
 */
export type WebsiteVenueCard = SearchResultCardData & {
  latitude: number | null;
  longitude: number | null;
  city?: string;
  seededTags?: string[];
  searchTags?: string[];
  specialsFood?: string[];
  specialsDrinks?: string[];
};

/** True when `card` matches `query` via the shared venue search helper. */
function matchesSearchQuery(card: WebsiteVenueCard, query: string): boolean {
  return (
    matchVenueSearchTier(query, {
      name: card.name,
      city: card.city ?? "",
      establishmentType: card.establishmentType,
      seededTags: card.seededTags ?? [],
      searchTags: card.searchTags ?? [],
      specialsFood: card.specialsFood ?? [],
      specialsDrinks: card.specialsDrinks ?? [],
    }) !== null
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NEAR_ME_RADIUS_KM = 25;
const TOP_RATED_MIN = 4.0;
// Matches the debounce already established for the homepage's autocomplete
// (HeroVenueSearch.tsx) — used here only to debounce the ?q= URL sync since
// the actual filtering is client-side/instant (no network round trip).
const SEARCH_URL_SYNC_DEBOUNCE_MS = 200;

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

/** "collection" is only offered when `collectionOrder` is passed — it preserves input order. */
type SortOption = "collection" | "distance" | "rating" | "az";

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

// ─── Dropdown panel contents ──────────────────────────────────────────────────
// Shared between the desktop absolute popover and the mobile inline panel (see
// render note above the chip bar for why mobile needs its own non-absolute copy).

function TimeFilterFields({
  filterTime,
  onChange,
  onClear,
}: {
  filterTime: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Happy hour at
      </p>
      <input
        type="time"
        value={filterTime}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent outline-none"
      />
      <p className="mt-2 text-xs text-gray-400 leading-tight">
        Shows venues with happy hour at this time on any day
      </p>
      {filterTime && (
        <button
          type="button"
          onClick={onClear}
          className="mt-2 text-xs text-gray-500 hover:text-gray-800 underline"
        >
          Clear
        </button>
      )}
    </>
  );
}

function TypeFilterOptions({
  establishmentTypes,
  selectedType,
  onSelect,
}: {
  establishmentTypes: string[];
  selectedType: string | null;
  onSelect: (type: string | null) => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(null)}
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
          onClick={() => onSelect(type)}
          className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
            selectedType === type ? "font-semibold text-gray-900" : "text-gray-700"
          }`}
        >
          {type}
        </button>
      ))}
    </>
  );
}

function SortOptions({
  sortBy,
  collectionOrder,
  hasLoc,
  onSelect,
}: {
  sortBy: SortOption;
  collectionOrder: boolean;
  hasLoc: boolean;
  onSelect: (sort: SortOption) => void;
}) {
  return (
    <>
      {collectionOrder && (
        <button
          type="button"
          onClick={() => onSelect("collection")}
          className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
            sortBy === "collection" ? "font-semibold text-gray-900" : "text-gray-700"
          }`}
        >
          Collection Order
        </button>
      )}
      <button
        type="button"
        onClick={() => onSelect("distance")}
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
        onClick={() => onSelect("rating")}
        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
          sortBy === "rating" ? "font-semibold text-gray-900" : "text-gray-700"
        }`}
      >
        Top Rated First
      </button>
      <button
        type="button"
        onClick={() => onSelect("az")}
        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
          sortBy === "az" ? "font-semibold text-gray-900" : "text-gray-700"
        }`}
      >
        A – Z
      </button>
    </>
  );
}

// ─── Search input ─────────────────────────────────────────────────────────────
// Same pill visual language as the homepage's HeroVenueSearch (border,
// rounded-full, shadow, amber focus ring, search icon) — kept consistent
// with the existing consumer experience rather than introducing a new style.

function VenueSearchInput({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div
      className="
        flex items-center gap-2.5 pl-4 pr-3 py-2.5
        bg-white border border-gray-200 rounded-full
        shadow-[0_1px_2px_rgba(0,0,0,0.04)]
        focus-within:ring-2 focus-within:ring-amber-400
        transition-all
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
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name, type, or specials…"
        aria-label="Search happy hours"
        autoComplete="off"
        className="flex-1 min-w-0 text-sm text-gray-900 placeholder:text-gray-400 bg-transparent outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="flex-shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
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

// ─── Main component ───────────────────────────────────────────────────────────

type Props = {
  cards: WebsiteVenueCard[];
  market: Market;
  /**
   * When provided, replaces the default SearchContextHeader in both desktop
   * and mobile layouts. Pass `null` (as opposed to leaving it `undefined`) to
   * suppress the header slot — and its wrapping margin/border — entirely,
   * e.g. when an ancestor (the Collection hero) already renders equivalent
   * context immediately above and a second heading/divider would read as two
   * disconnected pages.
   */
  contextHeader?: ReactNode | null;
  /**
   * When true, `cards` is treated as a pre-resolved, pre-ordered set (e.g. a
   * Venue Collection) rather than the full market. Adds "Collection Order" as
   * a selectable — and default — sort, which simply preserves `cards`' input
   * order. Filtering/other sorts still operate only within `cards`, so the
   * Collection membership boundary is never widened.
   */
  collectionOrder?: boolean;
  /** Rendered once, full-width, after the results in both desktop and mobile layouts. */
  footerCta?: ReactNode;
  /**
   * Enables the free-text search input and its ?q= URL sync. Off by default
   * so other callers of this component (Collections, Saved) are unaffected —
   * only website-happy-hours/page.tsx opts in today.
   */
  enableSearch?: boolean;
  /** Initial search value, read server-side from ?q=. Only meaningful when enableSearch is true. */
  initialQuery?: string;
};

export function HappyHoursSearchClient({
  cards,
  market,
  contextHeader,
  collectionOrder = false,
  footerCta,
  enableSearch = false,
  initialQuery = "",
}: Props) {
  const pathname = usePathname();

  // ── search state ──
  const [searchQuery, setSearchQuery] = useState(enableSearch ? initialQuery : "");

  // Debounced ?q= URL sync — filtering itself is instant/client-side (no
  // network round trip), so only the URL write is debounced, matching the
  // homepage autocomplete's existing debounce value.
  //
  // Uses history.replaceState() rather than next/navigation's router.replace().
  // This page is `force-dynamic` and reads `searchParams` to compute
  // initialQuery — router.replace() would re-render the server component on
  // every debounce tick, re-running getPublishedVenuesForConsumer() as the
  // user types, which is both an unnecessary DB round trip and the source of
  // update latency/raciness. history.replaceState() updates the address bar
  // and history entry directly, with no server involvement — filtering
  // already happens entirely client-side, so nothing server-rendered
  // actually depends on this URL update except a future hard reload/deep
  // link, which reads it correctly regardless of how it got there.
  useEffect(() => {
    if (!enableSearch) return;
    const trimmed = searchQuery.trim();
    const timer = setTimeout(() => {
      const url = trimmed ? `${pathname}?q=${encodeURIComponent(trimmed)}` : pathname;
      window.history.replaceState(null, "", url);
    }, SEARCH_URL_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery, enableSearch, pathname]);

  // ── filter state ──
  const [nearMeActive, setNearMeActive] = useState(false);
  const [onNowActive, setOnNowActive] = useState(false);
  const [topRatedActive, setTopRatedActive] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [filterTime, setFilterTime] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>(collectionOrder ? "collection" : "distance");

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

  // ── map/card sync state ──
  // hoveredCardId: set on card mouseenter → highlights matching marker
  // activeCardId:  set on marker click   → rings the matching card + scrolls it into view
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  // ── dropdown refs for click-outside ──
  // *Ref covers the chip button + desktop popover. *PanelRef additionally covers
  // the mobile inline panel (rendered outside the chip row — see below), so
  // interacting with it isn't mistaken for an outside click.
  const typeRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const typePanelRef = useRef<HTMLDivElement>(null);
  const sortPanelRef = useRef<HTMLDivElement>(null);
  const timePanelRef = useRef<HTMLDivElement>(null);

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
      if (
        typeOpen &&
        typeRef.current && !typeRef.current.contains(t) &&
        (!typePanelRef.current || !typePanelRef.current.contains(t))
      )
        setTypeOpen(false);
      if (
        sortOpen &&
        sortRef.current && !sortRef.current.contains(t) &&
        (!sortPanelRef.current || !sortPanelRef.current.contains(t))
      )
        setSortOpen(false);
      if (
        timeOpen &&
        timeRef.current && !timeRef.current.contains(t) &&
        (!timePanelRef.current || !timePanelRef.current.contains(t))
      )
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
    const trimmedQuery = searchQuery.trim();
    return cards.filter((card) => {
      if (trimmedQuery && !matchesSearchQuery(card, trimmedQuery)) return false;
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
    searchQuery,
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
  // "collection" never sorts at all — filteredCards already preserves `cards`' input
  // order (Array.filter is order-preserving), so this is exactly the resolved
  // Collection order, restored whenever the visitor switches back to it.
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

    if (sortBy === "collection") return withDist;

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
    setSearchQuery("");
    setNearMeActive(false);
    setOnNowActive(false);
    setTopRatedActive(false);
    setSelectedType(null);
    setFilterTime("");
  }

  // ── map markers — only venues with valid coordinates ──
  const mapMarkers = useMemo<MapMarker[]>(
    () =>
      sortedCards
        .filter((c) => c.latitude !== null && c.longitude !== null)
        .map((c) => {
          let subtitle: string | undefined;
          let subtitleColor: MapMarker["subtitleColor"] = "gray";

          // Computed client-side (this component is "use client") so it
          // reflects the viewer's actual wall-clock time — see
          // SearchResultCardData.happyHourWeekly.
          const hh = computeHhStatus(c.happyHourWeekly);

          if (hh.type === "active") {
            subtitle = `On Now · ${hh.endsIn}`;
            subtitleColor = "green";
          } else if (hh.type === "upcoming") {
            const day =
              hh.day === "Today"
                ? "Today"
                : hh.day === "Tomorrow"
                ? "Tomorrow"
                : hh.day;
            subtitle = `${day} · Starts ${hh.startsAt}`;
            subtitleColor = "amber";
          } else {
            subtitle = c.establishmentType || undefined;
            subtitleColor = "gray";
          }

          const metaParts: string[] = [];
          if (c.googleRating !== null)
            metaParts.push(`★ ${c.googleRating.toFixed(1)}`);
          if (c.distanceKm !== null)
            metaParts.push(`${c.distanceKm.toFixed(1)} km`);

          return {
            id: c.id,
            lat: c.latitude!,
            lng: c.longitude!,
            name: c.name,
            image: c.image,
            subtitle,
            subtitleColor,
            metaLine: metaParts.length > 0 ? metaParts.join(" · ") : undefined,
            href: c.href,
          };
        }),
    [sortedCards]
  );

  // Scroll the matching card into view when a marker is clicked.
  useEffect(() => {
    if (!activeCardId) return;
    const el = document.querySelector(`[data-card-id="${activeCardId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeCardId]);

  function handleMarkerClick(id: string | null) {
    setActiveCardId(id);
  }

  // ── chip labels ──

  const hasLoc = userLocation !== null;
  const sortLabel =
    sortBy === "collection"
      ? "Collection Order"
      : sortBy === "distance"
      ? "Nearest"
      : sortBy === "rating"
      ? "Top Rated"
      : "A-Z";
  const typeLabel = selectedType ?? "Type";
  const timeLabel = filterTime
    ? `Time: ${formatTimeDisplay(filterTime)}`
    : "Time";

  const anyFilter =
    !!searchQuery.trim() ||
    nearMeActive ||
    onNowActive ||
    topRatedActive ||
    !!selectedType ||
    !!filterTime;

  // ─── render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Sticky filter chip bar ─────────────────────────────────────────── */}
      <div className="sticky top-16 md:top-[72px] z-20 bg-white border-b border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        {enableSearch && (
          /* Desktop: constrained to the left results column's width/padding
             (matches the w-1/2 + px-5 results column below) rather than the
             full sticky-bar width, so the field reads as belonging to the
             venue list it filters instead of stretching across the map
             column too. Mobile is unaffected (single stacked column). */
          <div className="px-4 pt-3 md:w-1/2 md:px-5">
            <VenueSearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              onClear={() => setSearchQuery("")}
            />
          </div>
        )}
        <div className="flex items-center gap-2 px-4 md:px-6 py-3 overflow-x-auto md:overflow-visible [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">

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
            {/* Desktop: absolute popover anchored below the chip */}
            {timeOpen && (
              <div className="hidden md:block absolute top-full mt-2 left-0 z-30 bg-white rounded-2xl border border-gray-200 shadow-xl p-4 w-56">
                <TimeFilterFields
                  filterTime={filterTime}
                  onChange={setFilterTime}
                  onClear={() => {
                    setFilterTime("");
                    setTimeOpen(false);
                  }}
                />
              </div>
            )}
          </div>

          {/* TODO (post-launch):
              Reintroduce this filter once the venue dataset contains a broader
              distribution of ratings. When restored, consider renaming the chip
              to "Rated 4.0+" to better communicate that it is a threshold filter
              rather than a sort option. */}

          {/* Type */}
          <div ref={typeRef} className="relative flex-shrink-0">
            <ChipButton
              label={typeLabel}
              active={!!selectedType || typeOpen}
              onClick={() => setTypeOpen((v) => !v)}
              hasArrow
            />
            {/* Desktop: absolute popover anchored below the chip */}
            {typeOpen && (
              <div className="hidden md:block absolute top-full mt-2 left-0 z-30 bg-white rounded-2xl border border-gray-200 shadow-xl py-2 min-w-[180px]">
                <TypeFilterOptions
                  establishmentTypes={establishmentTypes}
                  selectedType={selectedType}
                  onSelect={(type) => {
                    setSelectedType(type);
                    setTypeOpen(false);
                  }}
                />
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
            {/* Desktop: absolute popover anchored below the chip */}
            {sortOpen && (
              <div className="hidden md:block absolute top-full mt-2 right-0 z-30 bg-white rounded-2xl border border-gray-200 shadow-xl py-2 min-w-[200px]">
                <SortOptions
                  sortBy={sortBy}
                  collectionOrder={collectionOrder}
                  hasLoc={hasLoc}
                  onSelect={(s) => {
                    setSortBy(s);
                    setSortOpen(false);
                  }}
                />
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

        {/* Mobile: dropdown panels render full-width below the chip row instead of as
            an absolute popover, because the chip row scrolls horizontally on mobile
            (overflow-x-auto) which clips/traps an absolutely-positioned child — the
            same pattern EventSearchResults.tsx uses for its mobile calendar panel. */}
        {timeOpen && (
          <div ref={timePanelRef} className="md:hidden border-t border-gray-100 bg-white px-4 py-4">
            <TimeFilterFields
              filterTime={filterTime}
              onChange={setFilterTime}
              onClear={() => {
                setFilterTime("");
                setTimeOpen(false);
              }}
            />
          </div>
        )}
        {typeOpen && (
          <div ref={typePanelRef} className="md:hidden border-t border-gray-100 bg-white px-2 py-2">
            <TypeFilterOptions
              establishmentTypes={establishmentTypes}
              selectedType={selectedType}
              onSelect={(type) => {
                setSelectedType(type);
                setTypeOpen(false);
              }}
            />
          </div>
        )}
        {sortOpen && (
          <div ref={sortPanelRef} className="md:hidden border-t border-gray-100 bg-white px-2 py-2">
            <SortOptions
              sortBy={sortBy}
              collectionOrder={collectionOrder}
              hasLoc={hasLoc}
              onSelect={(s) => {
                setSortBy(s);
                setSortOpen(false);
              }}
            />
          </div>
        )}

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
          {contextHeader !== null && (
            <div className="mb-7">
              {contextHeader ?? (
                <SearchContextHeader market={market} resultCount={sortedCards.length} />
              )}
            </div>
          )}

          {sortedCards.length === 0 ? (
            <EmptyState anyFilter={anyFilter} onClear={clearAllFilters} />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {sortedCards.map((card) => (
                <div
                  key={card.id}
                  data-card-id={card.id}
                  onMouseEnter={() => setHoveredCardId(card.id)}
                  onMouseLeave={() => setHoveredCardId(null)}
                  className={[
                    "rounded-2xl transition-shadow duration-150",
                    activeCardId === card.id
                      ? "ring-2 ring-amber-400 shadow-lg"
                      : "",
                  ].join(" ")}
                >
                  <SearchResultCard data={card} />
                </div>
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
            <SearchResultsMap
              markers={mapMarkers}
              marketCenter={market.mapCenter}
              marketZoom={market.mapZoom}
              className="flex-1 rounded-2xl overflow-hidden"
              hoveredMarkerId={hoveredCardId}
              onMarkerClick={handleMarkerClick}
            />
          </div>
        </div>
      </div>

      {/* ── Mobile: stacked layout ────────────────────────────────────────────── */}
      <div className="md:hidden">
        {contextHeader !== null && (
          <div className="px-4 pt-6 pb-5 border-b border-gray-100">
            {contextHeader ?? (
              <SearchContextHeader market={market} resultCount={sortedCards.length} />
            )}
          </div>
        )}

        <SearchResultsMap
          markers={mapMarkers}
          marketCenter={market.mapCenter}
          marketZoom={market.mapZoom}
          className="mx-4 my-4 h-52 rounded-2xl overflow-hidden"
        />

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

      {footerCta}
    </>
  );
}
