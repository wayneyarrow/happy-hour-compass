"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { haversineKm, isWithinBounds, type LatLngBounds } from "@/lib/geo";
import { computeHhStatus, getCurrentDayName } from "@/lib/happyHourStatus";
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

/** Parses an "HH:MM" string to minutes since midnight. NaN propagates on malformed input, which every comparison below treats as a non-match (mirrors the previous single-time filter's behavior). */
function timeStringToMinutes(hhMm: string): number {
  const [h, m] = hhMm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Returns true if any of the venue's weekly Happy Hour slots (any day)
 * overlaps the selected [selectedStartHhMm, selectedEndHhMm) range, using the
 * same start-inclusive/end-exclusive convention as computeHhStatus(): a slot
 * matches when slotStart < selectedEnd AND slotEnd > selectedStart.
 */
function hasHappyHourOverlap(
  weekly: Record<string, Array<{ start: string; end: string }>>,
  selectedStartHhMm: string,
  selectedEndHhMm: string
): boolean {
  const selectedStart = timeStringToMinutes(selectedStartHhMm);
  const selectedEnd = timeStringToMinutes(selectedEndHhMm);
  return Object.values(weekly).some((slots) =>
    slots.some((slot) => {
      const start = timeStringToMinutes(slot.start);
      const end = slot.end === "close" ? 1440 : timeStringToMinutes(slot.end);
      return start < selectedEnd && end > selectedStart;
    })
  );
}

/** True when `value` is a non-empty "HH:MM" string that parses to a finite number of minutes. Used only by hasHappyHourToday's slot-validity check below — "close" is deliberately NOT accepted here, since it's only ever a valid *end* value. */
function isFiniteHhTime(value: string): boolean {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(timeStringToMinutes(value))
  );
}

/**
 * Returns true if the venue has at least one non-malformed Happy Hour slot
 * on `todayName` — regardless of whether it's active right now, already
 * ended, or hasn't started yet. Independent of any selected Time range (see
 * the On Today + Time-range interaction in filteredCards below).
 *
 * A slot counts only when both start and end are valid: start must parse to
 * a finite time (never "close" — that's only ever an end value); end must
 * either parse to a finite time or be the literal "close".
 */
function hasHappyHourToday(
  weekly: Record<string, Array<{ start: string; end: string }>>,
  todayName: string
): boolean {
  const todaySlots = weekly[todayName] ?? [];
  return todaySlots.some(
    (slot) => isFiniteHhTime(slot.start) && (slot.end === "close" || isFiniteHhTime(slot.end))
  );
}

function formatTimeDisplay(hhMm: string): string {
  const [h, m] = hhMm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}:${String(m).padStart(2, "0")} ${period}`;
}

/** Compact range label, e.g. "3–6 PM" (same period), "11 AM–2 PM" (crosses noon), or "10 PM–Midnight". */
function formatTimeRangeDisplay(fromHhMm: string, toHhMm: string): string {
  const [fh, fm] = fromHhMm.split(":").map(Number);
  const fPeriod = fh >= 12 ? "PM" : "AM";
  const fDisplayH = fh === 0 ? 12 : fh > 12 ? fh - 12 : fh;
  const fShort = fm === 0 ? `${fDisplayH}` : `${fDisplayH}:${String(fm).padStart(2, "0")}`;

  // Midnight has no AM/PM of its own (it's the end-of-day sentinel, not
  // 12:00 AM the next day) — always show it against the From side's period.
  if (toHhMm === MIDNIGHT_VALUE) return `${fShort} ${fPeriod}–Midnight`;

  const [th, tm] = toHhMm.split(":").map(Number);
  const tPeriod = th >= 12 ? "PM" : "AM";
  const tDisplayH = th === 0 ? 12 : th > 12 ? th - 12 : th;
  const tShort = tm === 0 ? `${tDisplayH}` : `${tDisplayH}:${String(tm).padStart(2, "0")}`;
  if (fPeriod === tPeriod) return `${fShort}–${tShort} ${tPeriod}`;
  return `${fShort} ${fPeriod}–${tShort} ${tPeriod}`;
}

function minutesToTimeString(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Real Happy Hour schedule data (venues.beta.csv / venues.working.csv) shows
// slot starts from 2:00 PM–10:00 PM and non-"close" ends up to 6:00 PM, plus
// many "close" (midnight) ends. 11:00 AM–11:30 PM comfortably covers that
// with margin for earlier lunch-style specials, without an unusably long
// list. The overlap check compares against raw minutes, so "close" (1440)
// schedules are still matched correctly even against the plain 11:30 PM
// bound — Midnight (below) exists so users can also select it explicitly.
const TIME_OPTIONS_START_MIN = 11 * 60; // 11:00 AM
const TIME_OPTIONS_END_MIN = 23 * 60 + 30; // 11:30 PM
const TIME_OPTIONS_STEP_MIN = 30;

const TIME_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const opts: Array<{ value: string; label: string }> = [];
  for (
    let min = TIME_OPTIONS_START_MIN;
    min <= TIME_OPTIONS_END_MIN;
    min += TIME_OPTIONS_STEP_MIN
  ) {
    const value = minutesToTimeString(min);
    opts.push({ value, label: formatTimeDisplay(value) });
  }
  return opts;
})();

// End-of-day sentinel for the To selector only. "24:00" (not "00:00") so
// timeStringToMinutes() parses it as 1440 — end of the current day, matching
// how "close" is normalized in hasHappyHourOverlap — rather than midnight at
// the *start* of the day, which would silently break the overlap math and
// reopen the overnight-range case this filter intentionally doesn't support.
// String-sorts after every TIME_OPTIONS value ("24:00" > "23:30"), so it's
// always valid as a To choice regardless of the selected From.
const MIDNIGHT_VALUE = "24:00";
const MIDNIGHT_OPTION = { value: MIDNIGHT_VALUE, label: "Midnight" };
const TO_TIME_OPTIONS: Array<{ value: string; label: string }> = [
  ...TIME_OPTIONS,
  MIDNIGHT_OPTION,
];

// ─── Sort options ─────────────────────────────────────────────────────────────

/** "collection" is only offered when `collectionOrder` is passed — it preserves input order. */
type SortOption = "collection" | "distance" | "rating" | "az";

// ─── Chip button ──────────────────────────────────────────────────────────────

function ChipButton({
  label,
  active,
  onClick,
  hasArrow = false,
  ariaExpanded,
  ariaPressed,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  hasArrow?: boolean;
  /** When provided, exposes aria-expanded/aria-haspopup for a chip that opens a popover. */
  ariaExpanded?: boolean;
  /** When provided, exposes aria-pressed for a plain on/off toggle chip (no popover). */
  ariaPressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaExpanded !== undefined ? "true" : undefined}
      aria-pressed={ariaPressed}
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

// Matches the site's existing styled-native-select convention (see INPUT_CLASS
// in acquisition/ClaimVenueModalContent.tsx) — appearance-none + an inline SVG
// chevron, no new component or dependency.
const TIME_SELECT_CLASS =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "appearance-none bg-white bg-no-repeat bg-[right_10px_center] pr-8 " +
  "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")] " +
  "disabled:bg-gray-50 disabled:text-gray-400";

function TimeFilterFields({
  filterTimeFrom,
  filterTimeTo,
  onChangeFrom,
  onChangeTo,
  onClear,
}: {
  filterTimeFrom: string;
  filterTimeTo: string;
  onChangeFrom: (value: string) => void;
  onChangeTo: (value: string) => void;
  onClear: () => void;
}) {
  // Structurally prevents From ≥ To: once From is set, To only offers later
  // options (same-day ranges only — no overnight support). Midnight
  // ("24:00") always string-sorts after every real From value, so it never
  // gets filtered out here.
  const toOptions = filterTimeFrom
    ? TO_TIME_OPTIONS.filter((opt) => opt.value > filterTimeFrom)
    : TO_TIME_OPTIONS;

  return (
    <>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Happy hour time
      </p>
      <div className="space-y-3">
        <div>
          <label
            htmlFor="hh-time-from"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            From
          </label>
          <select
            id="hh-time-from"
            value={filterTimeFrom}
            onChange={(e) => onChangeFrom(e.target.value)}
            className={TIME_SELECT_CLASS}
          >
            <option value="">Any</option>
            {TIME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="hh-time-to"
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            To
          </label>
          <select
            id="hh-time-to"
            value={filterTimeTo}
            onChange={(e) => onChangeTo(e.target.value)}
            className={TIME_SELECT_CLASS}
          >
            <option value="">Any</option>
            {toOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-2 text-xs text-gray-400 leading-tight">
        Shows venues with happy hour overlapping this range on any day
      </p>
      {(filterTimeFrom || filterTimeTo) && (
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
  const [onTodayActive, setOnTodayActive] = useState(false);
  const [topRatedActive, setTopRatedActive] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [filterTimeFrom, setFilterTimeFrom] = useState("");
  const [filterTimeTo, setFilterTimeTo] = useState("");
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

  // ── mobile map interaction state ──
  // mapExpanded: true while the mobile map is in its enlarged "interaction
  // mode" (entered by tapping the map). mapBounds: the map's current viewport
  // while expanded, used to narrow the mobile venue list to what's visible —
  // same bounding-box technique the consumer app's map view already uses
  // (VenueDiscovery.tsx / VenueMapView.tsx), via the shared isWithinBounds()
  // helper (src/lib/geo.ts). Desktop's split layout is unaffected: its map
  // and card grid never read this state.
  const [mapExpanded, setMapExpanded] = useState(false);
  const [mapBounds, setMapBounds] = useState<LatLngBounds | null>(null);

  function handleCollapseMap() {
    setMapExpanded(false);
    setMapBounds(null);
  }

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

  // Same wall-clock convention as computeHhStatus() (see getCurrentDayName's
  // doc comment) — recomputed fresh each render/filter-change rather than
  // live-ticking, matching how On Now's clock already behaves on this page.
  const todayName = getCurrentDayName();

  // ── filter (live: On Now uses computeHhStatus so it reflects actual wall-clock time) ──
  const filteredCards = useMemo(() => {
    const hasLoc = userLocation !== null;
    const trimmedQuery = searchQuery.trim();
    return cards.filter((card) => {
      if (trimmedQuery && !matchesSearchQuery(card, trimmedQuery)) return false;
      if (onNowActive && computeHhStatus(card.happyHourWeekly).type !== "active")
        return false;
      if (onTodayActive && !hasHappyHourToday(card.happyHourWeekly, todayName))
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
      // Range is active only once both bounds are chosen — a single bound
      // never filters (see requirement: "only one selected → do not filter yet").
      // When On Today is also active, restrict the overlap check to today's
      // slots only (not every weekday) — a separate day's overlap shouldn't
      // count once the result set has already been narrowed to today.
      if (filterTimeFrom && filterTimeTo) {
        const weeklyForOverlap = onTodayActive
          ? { [todayName]: card.happyHourWeekly[todayName] ?? [] }
          : card.happyHourWeekly;
        if (!hasHappyHourOverlap(weeklyForOverlap, filterTimeFrom, filterTimeTo))
          return false;
      }
      return true;
    });
  }, [
    cards,
    searchQuery,
    onNowActive,
    onTodayActive,
    todayName,
    nearMeActive,
    userLocation,
    topRatedActive,
    selectedType,
    filterTimeFrom,
    filterTimeTo,
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
    setOnTodayActive(false);
    setTopRatedActive(false);
    setSelectedType(null);
    setFilterTimeFrom("");
    setFilterTimeTo("");
  }

  // Changing From can strand an already-picked To that's no longer later than
  // it (e.g. From moved past the existing To) — clear it rather than silently
  // snapping to a different time, which is the less surprising outcome.
  function handleFilterTimeFromChange(value: string) {
    setFilterTimeFrom(value);
    if (value && filterTimeTo && filterTimeTo <= value) {
      setFilterTimeTo("");
    }
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

  // Mobile-only: while the map is expanded and has reported a viewport, narrow
  // the venue list below it to only cards visible on screen. Collapsed
  // (default) mobile rendering and all of desktop use sortedCards directly and
  // never compute or read this — filters/sort/search above are unaffected,
  // this only ever narrows their already-produced result set.
  const mobileVisibleCards = useMemo(() => {
    if (!mapExpanded || !mapBounds) return sortedCards;
    return sortedCards.filter(
      (c) =>
        c.latitude !== null &&
        c.longitude !== null &&
        isWithinBounds(c.latitude, c.longitude, mapBounds)
    );
  }, [sortedCards, mapExpanded, mapBounds]);

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
  const timeLabel =
    filterTimeFrom && filterTimeTo
      ? `Time: ${formatTimeRangeDisplay(filterTimeFrom, filterTimeTo)}`
      : "Time";

  const anyFilter =
    !!searchQuery.trim() ||
    nearMeActive ||
    onNowActive ||
    onTodayActive ||
    topRatedActive ||
    !!selectedType ||
    !!filterTimeFrom ||
    !!filterTimeTo;

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

          {/* On Today */}
          <ChipButton
            label="On Today"
            active={onTodayActive}
            onClick={() => setOnTodayActive((v) => !v)}
            ariaPressed={onTodayActive}
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
              active={!!filterTimeFrom || !!filterTimeTo || timeOpen}
              onClick={() => setTimeOpen((v) => !v)}
              hasArrow
              ariaExpanded={timeOpen}
            />
            {/* Desktop: absolute popover anchored below the chip */}
            {timeOpen && (
              <div className="hidden md:block absolute top-full mt-2 left-0 z-30 bg-white rounded-2xl border border-gray-200 shadow-xl p-4 w-64">
                <TimeFilterFields
                  filterTimeFrom={filterTimeFrom}
                  filterTimeTo={filterTimeTo}
                  onChangeFrom={handleFilterTimeFromChange}
                  onChangeTo={setFilterTimeTo}
                  onClear={() => {
                    setFilterTimeFrom("");
                    setFilterTimeTo("");
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
              filterTimeFrom={filterTimeFrom}
              filterTimeTo={filterTimeTo}
              onChangeFrom={handleFilterTimeFromChange}
              onChangeTo={setFilterTimeTo}
              onClear={() => {
                setFilterTimeFrom("");
                setFilterTimeTo("");
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

        <div className="relative mx-4 my-4">
          <SearchResultsMap
            markers={mapMarkers}
            marketCenter={market.mapCenter}
            marketZoom={market.mapZoom}
            className={[
              "rounded-2xl overflow-hidden transition-[height] duration-300 ease-in-out",
              mapExpanded ? "h-[60dvh]" : "h-52",
            ].join(" ")}
            gestureHandling={mapExpanded ? "greedy" : "cooperative"}
            onBoundsChanged={mapExpanded ? setMapBounds : undefined}
            resizeSignal={mapExpanded}
          />

          {/* Collapsed: a transparent tap target expands the map in place —
              swallows the tap (so it doesn't fall through to a marker) while
              leaving vertical swipes free to scroll the page normally. */}
          {!mapExpanded && (
            <button
              type="button"
              onClick={() => setMapExpanded(true)}
              aria-label="Expand map"
              className="absolute inset-0 z-10 flex items-end justify-center pb-3"
            >
              <span className="px-3 py-1.5 rounded-full bg-gray-900/80 text-white text-xs font-medium shadow-lg">
                Tap to explore map
              </span>
            </button>
          )}

          {/* Expanded: explicit, always-visible way back to the default layout. */}
          {mapExpanded && (
            <button
              type="button"
              onClick={handleCollapseMap}
              className="absolute top-3 right-3 z-10 px-3.5 py-1.5 rounded-full bg-gray-900/85 text-white text-xs font-semibold shadow-lg"
            >
              Done
            </button>
          )}
        </div>

        {mapExpanded && mapBounds && sortedCards.length > 0 && (
          <p className="px-4 text-xs text-gray-500 mb-2">
            Showing {mobileVisibleCards.length} venue
            {mobileVisibleCards.length === 1 ? "" : "s"} in this area
          </p>
        )}

        {sortedCards.length === 0 ? (
          <div className="px-4 pb-8">
            <EmptyState anyFilter={anyFilter} onClear={clearAllFilters} />
          </div>
        ) : mobileVisibleCards.length === 0 ? (
          <div className="px-4 pb-8">
            <p className="text-sm text-gray-400 text-center py-8">
              Pan or zoom out to see venues in this area.
            </p>
          </div>
        ) : (
          <div className="px-4 pb-8 space-y-4">
            {mobileVisibleCards.map((card) => (
              <SearchResultCard key={card.id} data={card} />
            ))}
          </div>
        )}
      </div>

      {footerCta}
    </>
  );
}
