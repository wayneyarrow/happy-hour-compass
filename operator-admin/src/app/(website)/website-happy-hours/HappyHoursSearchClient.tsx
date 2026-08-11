"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { haversineKm, isWithinBounds, type LatLngBounds } from "@/lib/geo";
import { computeHhStatus, getCurrentDayName } from "@/lib/happyHourStatus";
import { matchVenueSearchTier } from "@/lib/data/venueSearch";
import { SearchResultCard, type SearchResultCardData } from "./SearchResultCard";
import SearchContextHeader from "./SearchContextHeader";
import { MobileMapResultsSheet, PEEK_HEIGHT_PX } from "./MobileMapResultsSheet";
import { SearchResultsMap, type MapMarker } from "../SearchResultsMap";
import { ControlPosition } from "@vis.gl/react-google-maps";
import type { Market } from "@/lib/markets";
import { trackGA4Event } from "@/lib/ga4";
import {
  TIME_OPTIONS,
  TO_TIME_OPTIONS,
  MIDNIGHT_VALUE,
  DAY_FILTER_OPTIONS,
  resolveDayName,
  resolveInitialDayFilter,
  resolveInitialTimeRange,
  type DayFilterValue,
} from "./searchFilters";

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

/**
 * Narrows `cards` to those within `bounds`, via the same shared
 * isWithinBounds() bounding-box helper (src/lib/geo.ts) the consumer app's
 * map view already uses. This is the one piece of viewport-filtering math in
 * this file — both the desktop split-layout map and the mobile expanded-map
 * results sheet call it, so neither surface reimplements its own geographic
 * filtering. Returns `cards` unchanged when `bounds` is null (no viewport
 * reported yet, or viewport filtering isn't active for this surface).
 */
function filterCardsWithinBounds<T extends { latitude: number | null; longitude: number | null }>(
  cards: T[],
  bounds: LatLngBounds | null
): T[] {
  if (!bounds) return cards;
  return cards.filter(
    (c) =>
      c.latitude !== null && c.longitude !== null && isWithinBounds(c.latitude, c.longitude, bounds)
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

/** True when `value` is a non-empty "HH:MM" string that parses to a finite number of minutes. Used only by hasValidHappyHourOnDay's slot-validity check below — "close" is deliberately NOT accepted here, since it's only ever a valid *end* value. */
function isFiniteHhTime(value: string): boolean {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(timeStringToMinutes(value))
  );
}

/**
 * Returns true if the venue has at least one non-malformed Happy Hour slot
 * on `dayName` — regardless of whether it's active right now, already ended,
 * or hasn't started yet. This is the Day filter's own check, independent of
 * any selected Time range — see the Day + Time interaction in filteredCards
 * below, where a complete From/To range further narrows this same day's
 * slots by overlap.
 *
 * `dayName` is null when the Day filter is set to "All Days" (the default —
 * see resolveDayName) — every venue passes unconditionally in that case, so
 * this never re-introduces a "has Happy Hour on some day" qualification gate
 * of its own; venue qualification is decided upstream of this page.
 *
 * A slot counts only when both start and end are valid: start must parse to
 * a finite time (never "close" — that's only ever an end value); end must
 * either parse to a finite time or be the literal "close".
 */
function hasValidHappyHourOnDay(
  weekly: Record<string, Array<{ start: string; end: string }>>,
  dayName: string | null
): boolean {
  if (dayName === null) return true;
  const daySlots = weekly[dayName] ?? [];
  return daySlots.some(
    (slot) => isFiniteHhTime(slot.start) && (slot.end === "close" || isFiniteHhTime(slot.end))
  );
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
  disabled = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  hasArrow?: boolean;
  /** When provided, exposes aria-expanded/aria-haspopup for a chip that opens a popover. */
  ariaExpanded?: boolean;
  /** When provided, exposes aria-pressed for a plain on/off toggle chip (no popover). */
  ariaPressed?: boolean;
  /** Native disabled semantics (not just visual styling) — removes the chip from the tab order and blocks clicks. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaExpanded !== undefined ? "true" : undefined}
      aria-pressed={ariaPressed}
      className={[
        "flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2",
        "border rounded-full text-sm font-medium whitespace-nowrap",
        "transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
        "disabled:opacity-50 disabled:pointer-events-none",
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
  idPrefix,
  filterTimeFrom,
  filterTimeTo,
  onChangeFrom,
  onChangeTo,
  onClear,
}: {
  /**
   * Distinguishes the desktop popover's and mobile panel's simultaneously-
   * rendered copies of these fields (see the two <TimeFilterFields> call
   * sites below) so their ids never collide — `id`/`htmlFor` must be unique
   * per rendered element regardless of which copy is currently visible.
   */
  idPrefix: string;
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
  const fromId = `hh-time-from-${idPrefix}`;
  const toId = `hh-time-to-${idPrefix}`;

  return (
    <>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Happy hour time
      </p>
      <div className="space-y-3">
        <div>
          <label
            htmlFor={fromId}
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            From
          </label>
          <select
            id={fromId}
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
            htmlFor={toId}
            className="block text-xs font-medium text-gray-600 mb-1"
          >
            To
          </label>
          <select
            id={toId}
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
        Shows venues with happy hour overlapping this range on the selected day
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

function DayFilterOptions({
  selectedDay,
  onSelect,
}: {
  selectedDay: DayFilterValue;
  onSelect: (day: DayFilterValue) => void;
}) {
  return (
    <>
      {DAY_FILTER_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSelect(opt.value)}
          className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
            selectedDay === opt.value ? "font-semibold text-gray-900" : "text-gray-700"
          }`}
        >
          {opt.label}
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
  /** Initial Day filter value, read server-side from ?day= (pre-normalized against ?now= — see resolveInitialDayFilter). Only meaningful when enableSearch is true. */
  initialDay?: DayFilterValue;
  /** Initial On Now state, read server-side from ?now=. Only meaningful when enableSearch is true. */
  initialOnNow?: boolean;
  /** Initial Time range, read server-side from ?from=/?to= (pre-validated — see resolveInitialTimeRange). Only meaningful when enableSearch is true. */
  initialTimeFrom?: string;
  initialTimeTo?: string;
};

export function HappyHoursSearchClient({
  cards,
  market,
  contextHeader,
  collectionOrder = false,
  footerCta,
  enableSearch = false,
  initialQuery = "",
  initialDay = "all",
  initialOnNow = false,
  initialTimeFrom = "",
  initialTimeTo = "",
}: Props) {
  const pathname = usePathname();

  // ── search state ──
  const [searchQuery, setSearchQuery] = useState(enableSearch ? initialQuery : "");

  // ── filter state ──
  const [nearMeActive, setNearMeActive] = useState(false);
  const [onNowActive, setOnNowActive] = useState(enableSearch ? initialOnNow : false);
  const [topRatedActive, setTopRatedActive] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<DayFilterValue>(
    enableSearch ? initialDay : "all"
  );
  const [filterTimeFrom, setFilterTimeFrom] = useState(enableSearch ? initialTimeFrom : "");
  const [filterTimeTo, setFilterTimeTo] = useState(enableSearch ? initialTimeTo : "");
  const [sortBy, setSortBy] = useState<SortOption>(collectionOrder ? "collection" : "distance");

  // GA4 discovery_filtered — latches false after the debounced URL-sync
  // effect's first ever firing for this mounted instance (the initial
  // page-load sync, not a genuine filter change) so only real subsequent
  // filter/search changes are counted. See the effect below.
  const isFirstFilterSyncRef = useRef(true);

  // ── dropdown open state ──
  const [typeOpen, setTypeOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);

  // Debounced URL sync for search + every filter chip + Sort — filtering
  // itself is instant/client-side (no network round trip), so only the URL
  // write is debounced, matching the homepage autocomplete's existing
  // debounce value.
  //
  // Uses history.replaceState() rather than next/navigation's router.replace().
  // This page is `force-dynamic` and reads `searchParams` to compute initial
  // filter state — router.replace() would re-render the server component on
  // every debounce tick, re-running getPublishedVenuesForConsumer() as the
  // user changes a filter, which is both an unnecessary DB round trip and
  // the source of update latency/raciness. history.replaceState() updates
  // the address bar and history entry directly, with no server involvement —
  // filtering already happens entirely client-side, so nothing
  // server-rendered actually depends on this URL update except a future hard
  // reload/deep link, which reads it correctly regardless of how it got
  // there. Every value at its own default ("all" for Day, inactive for
  // Near Me/On Now/Top Rated, no Type, and the sort each surface starts on)
  // is omitted entirely, matching this page's existing URL-cleanliness
  // convention for `q`. Map bounds/viewport are deliberately never included
  // here — they're not part of the search configuration this URL describes.
  useEffect(() => {
    if (!enableSearch) return;
    const trimmedQuery = searchQuery.trim();
    const defaultSort: SortOption = collectionOrder ? "collection" : "distance";
    const timer = setTimeout(() => {
      const parts: string[] = [];
      if (trimmedQuery) parts.push(`q=${encodeURIComponent(trimmedQuery)}`);
      if (selectedDay !== "all") parts.push(`day=${selectedDay}`);
      if (onNowActive) parts.push("now=1");
      if (filterTimeFrom) parts.push(`from=${filterTimeFrom}`);
      if (filterTimeTo) parts.push(`to=${filterTimeTo}`);
      if (nearMeActive) parts.push("near=1");
      if (topRatedActive) parts.push("top=1");
      if (selectedType) parts.push(`type=${encodeURIComponent(selectedType)}`);
      if (sortBy !== defaultSort) parts.push(`sort=${sortBy}`);
      const url = parts.length > 0 ? `${pathname}?${parts.join("&")}` : pathname;
      window.history.replaceState(null, "", url);

      // GA4 discovery_filtered — fires once per settled (debounced) filter
      // change, never on the initial mount sync. Sort is intentionally
      // excluded from the count: it reorders results, it doesn't filter them.
      if (isFirstFilterSyncRef.current) {
        isFirstFilterSyncRef.current = false;
      } else {
        const filterCount = [
          !!trimmedQuery,
          nearMeActive,
          onNowActive,
          !!selectedType,
          selectedDay !== "all",
          !!(filterTimeFrom && filterTimeTo),
        ].filter(Boolean).length;
        trackGA4Event("discovery_filtered", { mode: "happy_hours", filter_count: filterCount });
      }
    }, SEARCH_URL_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    searchQuery,
    selectedDay,
    onNowActive,
    filterTimeFrom,
    filterTimeTo,
    nearMeActive,
    topRatedActive,
    selectedType,
    sortBy,
    collectionOrder,
    enableSearch,
    pathname,
  ]);

  // Restores search/filter state from the live address bar once, on mount.
  // Needed for the browser Back button: history.replaceState() above keeps
  // the *address bar* in sync as filters change, but it deliberately never
  // calls Next.js's router, so it can't refresh what Next's client-side
  // Router Cache has stored for this route. When the visitor opens a venue
  // (a normal <Link> navigation) and returns via Back, Next restores this
  // component from that cache — a fresh mount using the *original*
  // initialQuery/initialDay/etc. props from before any filters were applied,
  // even though the address bar itself still shows the filtered URL. Since
  // the address bar is always correct (the browser, not Next, owns it during
  // a popstate restoration), re-parsing it once after mount reconciles state
  // with reality. A true fresh visit is a no-op here, since window.location
  // already matches the initial props in that case. Near Me/Top Rated/Type/
  // Sort have no server-side initial* prop counterpart (they're validated
  // here against the live `cards`/`collectionOrder` instead), since this
  // effect is the only place that ever reads them from the URL.
  useEffect(() => {
    if (!enableSearch) return;
    const params = new URLSearchParams(window.location.search);
    setSearchQuery(params.get("q") ?? "");
    const nowParam = params.get("now") === "1";
    setOnNowActive(nowParam);
    setSelectedDay(resolveInitialDayFilter(params.get("day") ?? undefined, nowParam));
    const { from, to } = resolveInitialTimeRange(
      params.get("from") ?? undefined,
      params.get("to") ?? undefined
    );
    setFilterTimeFrom(from);
    setFilterTimeTo(to);

    setNearMeActive(params.get("near") === "1");
    setTopRatedActive(params.get("top") === "1");

    const typeParam = params.get("type");
    setSelectedType(
      typeParam && cards.some((c) => c.establishmentType === typeParam) ? typeParam : null
    );

    const sortParam = params.get("sort");
    const validSorts: SortOption[] = collectionOrder
      ? ["collection", "distance", "rating", "az"]
      : ["distance", "rating", "az"];
    setSortBy(
      sortParam && (validSorts as string[]).includes(sortParam)
        ? (sortParam as SortOption)
        : collectionOrder
        ? "collection"
        : "distance"
    );
  }, [enableSearch, cards, collectionOrder]);

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
  //
  // mapBounds deliberately persists across collapse (tapping "Done") — it is
  // only ever replaced by a fresh onIdle report (re-panning/zooming the
  // expanded map) or by a filter/search/location/market change invalidating
  // `sortedCards`, never reset just for exiting the expanded map. "Done"
  // closes the expanded-map UI; it isn't a "discard my map search" action.
  const [mapExpanded, setMapExpanded] = useState(false);
  const [mapBounds, setMapBounds] = useState<LatLngBounds | null>(null);

  function handleCollapseMap() {
    setMapExpanded(false);
  }

  // ── desktop map interaction state ──
  // desktopMapBounds: current viewport of the desktop split-layout map,
  // narrowing the results column the same way mapBounds narrows mobile's
  // results sheet (see filterCardsWithinBounds above) — kept as separate
  // state because desktop's SearchResultsMap is a distinct, always-mounted
  // instance with no expand/collapse concept, so it starts reporting bounds
  // as soon as it mounts rather than only while "expanded". mapMarkers below
  // is intentionally NOT filtered by this — pins stay on the full filtered
  // set (sortedCards) so panning never changes the marker set, which is what
  // keeps SearchResultsMap's own fitBounds-on-marker-change effect from
  // re-firing on every pan (it only re-fits when filters/search/sort change
  // the underlying result set, never from the user's own map interaction).
  const [desktopMapBounds, setDesktopMapBounds] = useState<LatLngBounds | null>(null);

  function handleShowAllOnMap() {
    setDesktopMapBounds(null);
  }

  // Rendered pixel height of the map+sheet wrapper while expanded — read
  // fresh (rather than derived from the "70dvh" class) so the results sheet
  // can size its "open" snap point off the real box instead of duplicating
  // viewport-unit math. Measured ~320ms after expanding, matching the delay
  // SearchResultsMap's own resize-trigger already uses so it reads the
  // wrapper's settled post-transition height, and re-measured on resize
  // (e.g. orientation change) for as long as the map stays expanded.
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  const [expandedContainerHeightPx, setExpandedContainerHeightPx] = useState(0);

  useEffect(() => {
    if (!mapExpanded) return;
    function measure() {
      if (mapWrapperRef.current) {
        setExpandedContainerHeightPx(mapWrapperRef.current.clientHeight);
      }
    }
    const timer = setTimeout(measure, 320);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
  }, [mapExpanded]);

  // ── dropdown refs for click-outside ──
  // *Ref covers the chip button + desktop popover. *PanelRef additionally covers
  // the mobile inline panel (rendered outside the chip row — see below), so
  // interacting with it isn't mistaken for an outside click.
  const typeRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const dayRef = useRef<HTMLDivElement>(null);
  const typePanelRef = useRef<HTMLDivElement>(null);
  const sortPanelRef = useRef<HTMLDivElement>(null);
  const timePanelRef = useRef<HTMLDivElement>(null);
  const dayPanelRef = useRef<HTMLDivElement>(null);

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
      if (
        dayOpen &&
        dayRef.current && !dayRef.current.contains(t) &&
        (!dayPanelRef.current || !dayPanelRef.current.contains(t))
      )
        setDayOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [typeOpen, sortOpen, timeOpen, dayOpen]);

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

  // On Now forces Day to Today (Option A — see handleToggleOnNow), but this
  // is computed defensively here too rather than trusting that invariant
  // alone, since it's what the Time-range overlap check below evaluates
  // against.
  const effectiveDayName = resolveDayName(onNowActive ? "today" : selectedDay, todayName);

  // ── filter (live: On Now uses computeHhStatus so it reflects actual wall-clock time) ──
  // Ordered to mirror the product's Near Me → On Now → Day → Time → Type
  // filter sequence (Sort is a separate, later stage — see sortedCards
  // below). AND-combined checks are order-independent for correctness; this
  // ordering is purely for readability/maintainability.
  const filteredCards = useMemo(() => {
    const hasLoc = userLocation !== null;
    const trimmedQuery = searchQuery.trim();
    return cards.filter((card) => {
      if (trimmedQuery && !matchesSearchQuery(card, trimmedQuery)) return false;
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
      if (onNowActive && computeHhStatus(card.happyHourWeekly).type !== "active")
        return false;
      // Day is an independent filter ("All Days" by default — effectiveDayName
      // is null and every venue passes this check unconditionally): a venue
      // must have at least one valid Happy Hour slot on the effective day,
      // regardless of whether a Time range is set.
      if (!hasValidHappyHourOnDay(card.happyHourWeekly, effectiveDayName)) return false;
      // Time range is active only once both bounds are chosen — a single
      // bound never filters (see requirement: "only one selected → do not
      // filter yet"). Once active, it further narrows the already
      // Day-filtered result to slots overlapping the range — on the selected
      // day only when a specific day is chosen, or across every day of the
      // week when Day is "All Days" (effectiveDayName === null), since there
      // is no single day to constrain to in that case.
      if (filterTimeFrom && filterTimeTo) {
        const weeklyForOverlap =
          effectiveDayName === null
            ? card.happyHourWeekly
            : { [effectiveDayName]: card.happyHourWeekly[effectiveDayName] ?? [] };
        if (!hasHappyHourOverlap(weeklyForOverlap, filterTimeFrom, filterTimeTo))
          return false;
      }
      if (selectedType && card.establishmentType !== selectedType) return false;
      return true;
    });
  }, [
    cards,
    searchQuery,
    nearMeActive,
    userLocation,
    topRatedActive,
    onNowActive,
    effectiveDayName,
    filterTimeFrom,
    filterTimeTo,
    selectedType,
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
    setFilterTimeFrom("");
    setFilterTimeTo("");
    setSelectedDay("all");
  }

  // Option A: turning On Now on forces Day back to Today and disables the
  // control (closing its dropdown if it happened to be open); turning On Now
  // off simply re-enables Day, which is already Today — no prior weekday is
  // restored (see requirements: "Do not restore a previously selected
  // weekday or add extra state for that purpose").
  function handleToggleOnNow() {
    setOnNowActive((prev) => {
      const next = !prev;
      if (next) {
        setSelectedDay("today");
        setDayOpen(false);
      }
      return next;
    });
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

  // Mobile-only: once the map has reported a viewport (from expanding and
  // panning/zooming it), narrow the venue list to only cards within that
  // viewport — both while the map is expanded AND after collapsing it via
  // "Done", so the normal list keeps reflecting the visitor's own map search
  // instead of reverting to the unfiltered set (mapBounds is null until the
  // map first reports a viewport, and filterCardsWithinBounds passes cards
  // through unchanged when bounds is null — matching prior behavior before
  // the map has ever been used). Desktop uses its own separate
  // desktopVisibleCards/desktopMapBounds and never reads this — filters/sort/
  // search above are unaffected, this only ever narrows their already-
  // produced result set.
  const mobileVisibleCards = useMemo(
    () => filterCardsWithinBounds(sortedCards, mapBounds),
    [sortedCards, mapBounds]
  );

  // Desktop equivalent — always live (no expand/collapse gate), since the
  // split-layout map is visible and interactive from first render. Markers
  // (mapMarkers, above) intentionally stay on the full sortedCards set; only
  // this list-facing value narrows with the viewport.
  const desktopVisibleCards = useMemo(
    () => filterCardsWithinBounds(sortedCards, desktopMapBounds),
    [sortedCards, desktopMapBounds]
  );

  // Label shown in the results sheet's header — visible in both the peek and
  // open states, so it doubles as the live viewport count while collapsed.
  // Recomputes on every mapBounds change (see mobileVisibleCards above),
  // which fires from the map's onIdle after each pan/zoom.
  const sheetHeaderLabel =
    sortedCards.length === 0
      ? "No venues found"
      : mobileVisibleCards.length === 0
      ? "No venues in this area"
      : `${mobileVisibleCards.length} venue${mobileVisibleCards.length === 1 ? "" : "s"}`;

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
  const dayLabel = `Day: ${DAY_FILTER_OPTIONS.find((o) => o.value === selectedDay)?.label ?? "All Days"}`;

  const anyFilter =
    !!searchQuery.trim() ||
    nearMeActive ||
    onNowActive ||
    topRatedActive ||
    !!selectedType ||
    !!filterTimeFrom ||
    !!filterTimeTo ||
    selectedDay !== "all";

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

          {/* Near Me — quick "right now" shortcut (see On Now below). */}
          <ChipButton
            label="Near Me"
            active={nearMeActive}
            onClick={handleNearMe}
          />

          {/* On Now — quick "right now" shortcut, placed with Near Me ahead
              of the planning-ahead controls (Day, Time). */}
          <ChipButton
            label="On Now"
            active={onNowActive}
            onClick={handleToggleOnNow}
          />

          {/* Day — planning-ahead control, placed immediately after On Now
              (Option A: On Now forces Today and disables this control; see
              handleToggleOnNow). */}
          <div ref={dayRef} className="relative flex-shrink-0">
            <ChipButton
              label={dayLabel}
              active={selectedDay !== "all" || dayOpen}
              onClick={() => setDayOpen((v) => !v)}
              hasArrow
              ariaExpanded={dayOpen}
              disabled={onNowActive}
            />
            {/* Desktop: absolute popover anchored below the chip */}
            {dayOpen && (
              <div className="hidden md:block absolute top-full mt-2 left-0 z-30 bg-white rounded-2xl border border-gray-200 shadow-xl py-2 min-w-[180px]">
                <DayFilterOptions
                  selectedDay={selectedDay}
                  onSelect={(day) => {
                    setSelectedDay(day);
                    setDayOpen(false);
                  }}
                />
              </div>
            )}
          </div>

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
                  idPrefix="desktop"
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
        {dayOpen && (
          <div ref={dayPanelRef} className="md:hidden border-t border-gray-100 bg-white px-2 py-2">
            <DayFilterOptions
              selectedDay={selectedDay}
              onSelect={(day) => {
                setSelectedDay(day);
                setDayOpen(false);
              }}
            />
          </div>
        )}
        {timeOpen && (
          <div ref={timePanelRef} className="md:hidden border-t border-gray-100 bg-white px-4 py-4">
            <TimeFilterFields
              idPrefix="mobile"
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
          <p role="status" aria-live="polite" className="px-4 md:px-6 pb-2.5 text-xs text-amber-700">
            We couldn&rsquo;t access your location, so Near Me is unavailable. You
            can allow location access in your browser settings, or select a
            location manually instead.
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
                <SearchContextHeader market={market} resultCount={desktopVisibleCards.length} />
              )}
            </div>
          )}

          {/* Map-narrowed notice — only when the map viewport has actually
              excluded some of the filtered results (not just whenever bounds
              are known). "Show all results" resets only the viewport filter,
              never the map position itself or any other filter — panning
              back out re-widens it naturally instead. */}
          {desktopMapBounds &&
            desktopVisibleCards.length > 0 &&
            desktopVisibleCards.length < sortedCards.length && (
              <p className="mb-4 text-xs text-gray-500">
                Showing {desktopVisibleCards.length} of {sortedCards.length} venue
                {sortedCards.length === 1 ? "" : "s"} in this area ·{" "}
                <button
                  type="button"
                  onClick={handleShowAllOnMap}
                  className="text-amber-600 hover:text-amber-700 font-medium underline"
                >
                  Show all results
                </button>
              </p>
            )}

          {sortedCards.length === 0 ? (
            <EmptyState anyFilter={anyFilter} onClear={clearAllFilters} />
          ) : desktopVisibleCards.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm font-semibold text-gray-500">No venues in this area</p>
              <p className="text-xs text-gray-400 mt-1">
                Pan or zoom out on the map, or
              </p>
              <button
                type="button"
                onClick={handleShowAllOnMap}
                className="mt-2 text-sm text-amber-600 hover:text-amber-700 font-medium underline"
              >
                Show all results
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {desktopVisibleCards.map((card) => (
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
                  <SearchResultCard data={card} effectiveDayName={effectiveDayName} />
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
              onBoundsChanged={setDesktopMapBounds}
              userLocation={userLocation}
            />
          </div>
        </div>
      </div>

      {/* ── Mobile: stacked layout ────────────────────────────────────────────── */}
      <div className="md:hidden">
        {contextHeader !== null && (
          <div className="px-4 pt-6 pb-5 border-b border-gray-100">
            {contextHeader ?? (
              <SearchContextHeader market={market} resultCount={mobileVisibleCards.length} />
            )}
          </div>
        )}

        <div
          ref={mapWrapperRef}
          className={[
            "relative mx-4 my-4 rounded-2xl overflow-hidden transition-[height] duration-300 ease-in-out",
            mapExpanded ? "h-[70dvh]" : "h-52",
          ].join(" ")}
        >
          <SearchResultsMap
            markers={mapMarkers}
            marketCenter={market.mapCenter}
            marketZoom={market.mapZoom}
            className="absolute inset-0"
            gestureHandling={mapExpanded ? "greedy" : "cooperative"}
            onBoundsChanged={mapExpanded ? setMapBounds : undefined}
            resizeSignal={mapExpanded}
            // The results sheet permanently anchors to the bottom edge once
            // expanded (even at "peek" height) — Google's default
            // bottom-right zoom control would sit directly behind it, so
            // move it to the top-left corner (the one corner the sheet, the
            // "Done" button, and the InfoWindow layout never occupy).
            // Collapsed mobile and desktop are unaffected (prop omitted).
            zoomControlPosition={mapExpanded ? ControlPosition.LEFT_TOP : undefined}
            userLocation={userLocation}
            // The results sheet never fully closes while expanded — it always
            // covers at least PEEK_HEIGHT_PX of the map's bottom edge, even at
            // rest. Without this, reported bounds (and therefore the result
            // count/list derived from them) include venues that are
            // geographically in view but visually hidden behind the sheet.
            // Deliberately keyed to the sheet's minimum (peek) height, not its
            // live drag height — dragging the sheet open only reveals more of
            // the already-computed list, it never recomputes bounds.
            boundsBottomInsetPx={mapExpanded ? PEEK_HEIGHT_PX : undefined}
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

          {/* Expanded: the results sheet's drag/tap header now owns
              revealing the list vs. seeing more map (see
              MobileMapResultsSheet), but it never fully exits the expanded
              map — "Done" remains the one explicit, always-reachable way
              back to the original compact layout. It sits within the sheet's
              top gap (OPEN_TOP_GAP_PX) at every sheet state, so it's never
              covered by the sheet itself. */}
          {mapExpanded && (
            <>
              <button
                type="button"
                onClick={handleCollapseMap}
                className="absolute top-3 right-3 z-30 px-3.5 py-1.5 rounded-full bg-gray-900/85 text-white text-xs font-semibold shadow-lg"
              >
                Done
              </button>

              <MobileMapResultsSheet
                containerHeightPx={expandedContainerHeightPx}
                headerLabel={sheetHeaderLabel}
              >
                {sortedCards.length === 0 ? (
                  <EmptyState anyFilter={anyFilter} onClear={clearAllFilters} />
                ) : mobileVisibleCards.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">
                    Pan or zoom out to see venues in this area.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {mobileVisibleCards.map((card) => (
                      <SearchResultCard key={card.id} data={card} effectiveDayName={effectiveDayName} />
                    ))}
                  </div>
                )}
              </MobileMapResultsSheet>
            </>
          )}
        </div>

        {/* Default (collapsed) layout — normal document flow, no sheet.
            Renders mobileVisibleCards (not sortedCards): once the visitor has
            panned/zoomed the expanded map, "Done" preserves that map-filtered
            result set here rather than reverting to the unfiltered list (see
            mobileVisibleCards above). Before the map has ever reported a
            viewport, mobileVisibleCards equals sortedCards, so this is
            unchanged from prior behaviour. */}
        {!mapExpanded &&
          (sortedCards.length === 0 ? (
            <div className="px-4 pb-8">
              <EmptyState anyFilter={anyFilter} onClear={clearAllFilters} />
            </div>
          ) : mobileVisibleCards.length === 0 ? (
            <div className="px-4 pb-8">
              <p className="text-sm text-gray-400 text-center py-8">
                Expand the map and pan or zoom out to see venues in this area.
              </p>
            </div>
          ) : (
            <div className="px-4 pb-8 space-y-4">
              {mobileVisibleCards.map((card) => (
                <SearchResultCard key={card.id} data={card} effectiveDayName={effectiveDayName} />
              ))}
            </div>
          ))}
      </div>

      {footerCta}
    </>
  );
}
