"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { SearchResultsMap, type MapMarker } from "../SearchResultsMap";
import type { WebsiteEventListItem } from "@/lib/data/events";
import type { Market } from "@/lib/markets";
import { EVENT_TYPE_OPTIONS } from "@/lib/eventTypes";
import { EventSearchCard } from "./EventSearchCard";
import EventSearchContextHeader from "./EventSearchContextHeader";
import { trackGA4Event } from "@/lib/ga4";

// ─── Calendar helpers (adapted from EventsDiscovery) ─────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function todayLocal(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function tomorrowLocal(): Date {
  const d = todayLocal();
  d.setDate(d.getDate() + 1);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Inverse of toIso(). Returns null for a malformed or non-round-tripping (e.g. Feb 30) date string. */
function parseIsoLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

function fmtFieldDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtRangeLabel(start: Date, end: Date): string {
  if (isSameDay(start, end)) return fmtFieldDate(start);
  const startLabel = `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()}`;
  const endLabel = `${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}`;
  return `${startLabel} – ${endLabel}`;
}

function buildCalendarCells(month: Date): Array<Date | null> {
  const year = month.getFullYear();
  const m = month.getMonth();
  const firstDow = new Date(year, m, 1).getDay();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const cells: Array<Date | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, m, d));
  return cells;
}

// ─── Filter helpers ───────────────────────────────────────────────────────────

function dowFromIso(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

function eventOccursOnDow(e: WebsiteEventListItem, dow: number): boolean {
  if (e.recurrence === "daily") return true;
  if (!e.firstDate) return true; // permissive for undated
  return dowFromIso(e.firstDate) === dow;
}

function eventOccursInRange(
  e: WebsiteEventListItem,
  start: Date,
  end: Date
): boolean {
  if (e.recurrence === "daily") return true;
  if (!e.firstDate) return true; // permissive for undated
  const isRecurring = e.recurrence && e.recurrence !== "none";
  if (!isRecurring) {
    return e.firstDate >= toIso(start) && e.firstDate <= toIso(end);
  }
  // Recurring: does the event's DOW appear anywhere in the range?
  const eventDow = dowFromIso(e.firstDate);
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getDay() === eventDow) return true;
    cur.setDate(cur.getDate() + 1);
  }
  return false;
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-8">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-5">
        <svg
          className="w-8 h-8 text-amber-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
      <p className="text-lg font-bold text-gray-900 mb-2">
        {hasFilters ? "No events match your filters" : "No upcoming events"}
      </p>
      <p className="text-sm text-gray-500 max-w-xs leading-relaxed">
        {hasFilters
          ? "Try a different date or clear your filters to see all events."
          : "Events will appear here as they're added. Check back soon."}
      </p>
    </div>
  );
}

// ─── Filter chip ──────────────────────────────────────────────────────────────

function CalendarIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

type ChipProps = {
  label: string;
  icon?: ReactNode;
  chevron?: boolean;
  active?: boolean;
  open?: boolean;
  onClick: () => void;
  onClear?: () => void;
};

function FilterChip({ label, icon, chevron, active, open, onClick, onClear }: ChipProps) {
  // The clear action used to be a `<span role="button">` nested inside this
  // chip's own `<button>` — invalid HTML (a button may not contain other
  // interactive content) and inaccessible (tabIndex={-1} meant keyboard users
  // could never reach it at all; a real nested button would also double-fire
  // via click bubbling, which the previous version worked around with
  // stopPropagation). Rendered as an independent sibling `<button>` instead:
  // both controls are properly focusable/keyboard-activatable, and since
  // there's no nesting there's no bubbling to guard against.
  const showClear = !!(active && onClear);
  return (
    <span
      className={`
        flex-shrink-0 flex items-center rounded-full
        text-sm font-medium whitespace-nowrap
        shadow-[0_1px_2px_rgba(0,0,0,0.04)]
        transition-all
        ${
          active
            ? "bg-amber-500 border border-amber-500 text-white"
            : open
            ? "bg-amber-50 border border-amber-300 text-amber-800"
            : "bg-white border border-gray-200 text-gray-800 hover:border-gray-300 hover:bg-gray-50"
        }
      `}
    >
      <button
        type="button"
        onClick={onClick}
        className={`flex items-center gap-1.5 py-2 pl-4 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
          showClear ? "pr-1.5" : "pr-4"
        }`}
      >
        {icon && <span className="flex-shrink-0 opacity-75">{icon}</span>}
        {label}
        {chevron && !active && (
          <svg
            className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {showClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear filter"
          className="flex items-center py-2 pl-0.5 pr-3 rounded-full opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M6.707 6l2.647-2.646a.5.5 0 00-.708-.708L6 5.293 3.354 2.646a.5.5 0 00-.708.708L5.293 6 2.646 8.646a.5.5 0 00.708.708L6 6.707l2.646 2.647a.5.5 0 00.708-.708L6.707 6z" />
          </svg>
        </button>
      )}
    </span>
  );
}

// ─── Calendar panel ───────────────────────────────────────────────────────────

type CalendarPanelProps = {
  today: Date;
  calendarMonth: Date;
  selectedStart: Date | null;
  selectedEnd: Date | null;
  activeField: "from" | "to";
  onNavigateMonth: (dir: -1 | 1) => void;
  onSetActiveField: (f: "from" | "to") => void;
  onDayClick: (date: Date) => void;
  onApply: () => void;
  onClear: () => void;
  noBorderTop?: boolean;
};

function CalendarPanel({
  today,
  calendarMonth,
  selectedStart,
  selectedEnd,
  activeField,
  onNavigateMonth,
  onSetActiveField,
  onDayClick,
  onApply,
  onClear,
  noBorderTop = false,
}: CalendarPanelProps) {
  const cells = buildCalendarCells(calendarMonth);
  const prevDisabled =
    calendarMonth.getFullYear() === today.getFullYear() &&
    calendarMonth.getMonth() === today.getMonth();

  function getDayState(
    date: Date
  ): "disabled" | "range-start" | "range-end" | "in-range" | "today" | "" {
    if (date < today && !isSameDay(date, today)) return "disabled";
    if (selectedStart && isSameDay(date, selectedStart)) return "range-start";
    if (selectedEnd && isSameDay(date, selectedEnd)) return "range-end";
    if (
      selectedStart &&
      selectedEnd &&
      date > selectedStart &&
      date < selectedEnd
    )
      return "in-range";
    if (isSameDay(date, today)) return "today";
    return "";
  }

  return (
    <div className={`${noBorderTop ? "" : "border-t border-gray-100 "}bg-white px-4 md:px-6 py-4`}>
      {/* From / To fields */}
      <div className="flex gap-3 mb-3 pb-3 border-b border-gray-100">
        {(["from", "to"] as const).map((field) => {
          const date = field === "from" ? selectedStart : selectedEnd;
          const isActive = activeField === field;
          return (
            <button
              key={field}
              type="button"
              onClick={() => onSetActiveField(field)}
              className={`flex-1 px-3 py-2.5 border-2 rounded-xl text-left transition-all ${
                isActive
                  ? "border-amber-400 bg-amber-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">
                {field === "from" ? "From" : "To"}
              </p>
              <p
                className={`text-sm font-medium ${
                  date ? "text-gray-900" : "text-gray-400 italic"
                }`}
              >
                {date
                  ? fmtFieldDate(date)
                  : field === "from"
                  ? "Select start"
                  : "Select end"}
              </p>
            </button>
          );
        })}
      </div>

      {/* Helper text */}
      <p className="text-xs text-gray-500 text-center bg-gray-50 rounded-lg px-3 py-2 mb-3">
        {activeField === "from" ? "Select a start date" : "Select an end date"}
      </p>

      {/* Month navigation */}
      <div className="flex justify-between items-center mb-3">
        <button
          type="button"
          onClick={() => onNavigateMonth(-1)}
          disabled={prevDisabled}
          aria-label="Previous month"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="text-[15px] font-semibold text-gray-900">
          {MONTHS[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
        </span>
        <button
          type="button"
          onClick={() => onNavigateMonth(1)}
          aria-label="Next month"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-[11px] font-semibold text-gray-400 py-1.5">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1 mb-4">
        {cells.map((date, i) => {
          if (!date) return <div key={`e-${i}`} />;
          const state = getDayState(date);
          return (
            <button
              key={i}
              type="button"
              disabled={state === "disabled"}
              onClick={() => onDayClick(date)}
              className={[
                "aspect-square flex items-center justify-center text-sm font-medium rounded-lg transition-all",
                state === "disabled"
                  ? "text-gray-300 cursor-not-allowed"
                  : state === "range-start" || state === "range-end"
                  ? "bg-amber-500 text-white font-semibold shadow-sm"
                  : state === "in-range"
                  ? "bg-amber-50 text-amber-900"
                  : state === "today"
                  ? "text-amber-600 font-bold hover:bg-gray-100"
                  : "text-gray-900 hover:bg-gray-100",
              ].join(" ")}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={!selectedStart || !selectedEnd}
          className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={onClear}
          className="flex-1 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-50 transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

// ─── EventTypePanel ───────────────────────────────────────────────────────────

type EventTypePanelProps = {
  activeType: string | null;
  onSelect: (type: string | null) => void;
};

function EventTypePanel({ activeType, onSelect }: EventTypePanelProps) {
  return (
    <div className="border-t border-gray-200 bg-white px-4 md:px-6 py-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3.5">
        Event Type
      </p>
      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
            activeType === null
              ? "bg-amber-500 border-amber-500 text-white"
              : "bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
          }`}
        >
          All Types
        </button>
        {EVENT_TYPE_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(activeType === value ? null : value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
              activeType === value
                ? "bg-amber-500 border-amber-500 text-white"
                : "bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── EventSearchResults ───────────────────────────────────────────────────────

type DateFilter = "today" | "tomorrow" | "weekend" | null;

// Matches the debounce already established for the Happy Hours search page's
// ?q= URL sync (HappyHoursSearchClient.tsx) — filtering itself stays
// instant/client-side, only the URL write is debounced.
const FILTER_URL_SYNC_DEBOUNCE_MS = 200;

type Props = {
  events: WebsiteEventListItem[];
  market: Market;
  /** When provided, replaces the default EventSearchContextHeader in both desktop and mobile layouts. */
  contextHeader?: ReactNode;
  /** Rendered once, full-width, after the results in both desktop and mobile layouts. */
  footerCta?: ReactNode;
  /**
   * Enables the ?date=/?from=/?to=/?type= URL sync and mount-time restore.
   * Off by default so other callers of this component (Saved, Collections)
   * are unaffected — only website-events/page.tsx opts in today.
   */
  enableFilterSync?: boolean;
};

export function EventSearchResults({
  events,
  market,
  contextHeader,
  footerCta,
  enableFilterSync = false,
}: Props) {
  const pathname = usePathname();

  const today = todayLocal();
  const tomorrow = tomorrowLocal();

  // ── Date filter chips ──────────────────────────────────────────────────────
  const [dateFilter, setDateFilter] = useState<DateFilter>(null);

  function setDate(f: DateFilter) {
    setDateFilter((cur) => (cur === f ? null : f));
    // Clear calendar when switching to a chip filter
    setCalAppliedStart(null);
    setCalAppliedEnd(null);
    setCalSelectedStart(null);
    setCalSelectedEnd(null);
    if (calendarOpen) setCalendarOpen(false);
    if (typeOpen) setTypeOpen(false);
  }

  // ── Calendar state ────────────────────────────────────────────────────────
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [calSelectedStart, setCalSelectedStart] = useState<Date | null>(null);
  const [calSelectedEnd, setCalSelectedEnd] = useState<Date | null>(null);
  const [calAppliedStart, setCalAppliedStart] = useState<Date | null>(null);
  const [calAppliedEnd, setCalAppliedEnd] = useState<Date | null>(null);
  const [calActiveField, setCalActiveField] = useState<"from" | "to">("from");

  const hasAppliedRange = calAppliedStart !== null;

  function toggleCalendar() {
    if (typeOpen) setTypeOpen(false);
    if (calendarOpen) {
      setCalSelectedStart(calAppliedStart);
      setCalSelectedEnd(calAppliedEnd);
      setCalendarOpen(false);
    } else {
      const initStart = calAppliedStart ?? today;
      const initEnd = calAppliedEnd ?? today;
      setCalSelectedStart(initStart);
      setCalSelectedEnd(initEnd);
      setCalendarMonth(new Date(initStart.getFullYear(), initStart.getMonth(), 1));
      setCalActiveField("from");
      setCalendarOpen(true);
    }
  }

  function handleDayClick(date: Date) {
    if (date < today && !isSameDay(date, today)) return;
    if (calActiveField === "from") {
      setCalSelectedStart(date);
      if (calSelectedEnd && calSelectedEnd < date) setCalSelectedEnd(date);
      setCalActiveField("to");
    } else {
      if (calSelectedStart && date < calSelectedStart) {
        setCalSelectedStart(date);
        setCalSelectedEnd(date);
        setCalActiveField("to");
      } else {
        setCalSelectedEnd(date);
      }
    }
  }

  function applyCalendar() {
    if (!calSelectedStart || !calSelectedEnd) return;
    setCalAppliedStart(calSelectedStart);
    setCalAppliedEnd(calSelectedEnd);
    setDateFilter(null); // clear chip filters
    setCalendarOpen(false);
  }

  function clearCalendar() {
    setCalSelectedStart(null);
    setCalSelectedEnd(null);
    setCalAppliedStart(null);
    setCalAppliedEnd(null);
    setCalendarOpen(false);
  }

  function clearRangeFilter() {
    clearCalendar();
  }

  // ── Event type filter ─────────────────────────────────────────────────────
  const [activeType, setActiveType] = useState<string | null>(null);
  const [typeOpen, setTypeOpen] = useState(false);

  // GA4 discovery_filtered — latches false after the debounced URL-sync
  // effect's first ever firing for this mounted instance (the initial
  // page-load sync, not a genuine filter change) so only real subsequent
  // filter changes are counted. See the effect below.
  const isFirstFilterSyncRef = useRef(true);

  function toggleTypePanel() {
    if (calendarOpen) setCalendarOpen(false);
    setTypeOpen((v) => !v);
  }

  function selectType(type: string | null) {
    setActiveType(type);
    setTypeOpen(false);
  }

  // Debounced URL sync for the Date/Calendar/Type filters, mirroring the
  // Happy Hours search page's ?q= sync (HappyHoursSearchClient.tsx). Uses
  // history.replaceState() directly rather than next/navigation's
  // router.replace() for the same reason: this page's filtering is entirely
  // client-side, so a router-driven update would trigger an unnecessary
  // server re-render on every change.
  useEffect(() => {
    if (!enableFilterSync) return;
    const timer = setTimeout(() => {
      const parts: string[] = [];
      if (dateFilter) {
        parts.push(`date=${dateFilter}`);
      } else if (hasAppliedRange && calAppliedStart && calAppliedEnd) {
        parts.push(`from=${toIso(calAppliedStart)}`);
        parts.push(`to=${toIso(calAppliedEnd)}`);
      }
      if (activeType) parts.push(`type=${encodeURIComponent(activeType)}`);
      const url = parts.length > 0 ? `${pathname}?${parts.join("&")}` : pathname;
      window.history.replaceState(null, "", url);

      // GA4 discovery_filtered — fires once per settled (debounced) filter
      // change, never on the initial mount sync.
      if (isFirstFilterSyncRef.current) {
        isFirstFilterSyncRef.current = false;
      } else {
        const filterCount = [!!dateFilter, hasAppliedRange, !!activeType].filter(Boolean).length;
        trackGA4Event("discovery_filtered", { mode: "events", filter_count: filterCount });
      }
    }, FILTER_URL_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enableFilterSync, dateFilter, hasAppliedRange, calAppliedStart, calAppliedEnd, activeType, pathname]);

  // Restores filter state from the live address bar once, on mount — see the
  // matching effect and comment in HappyHoursSearchClient.tsx for why this is
  // necessary: history.replaceState() above keeps the address bar in sync,
  // but Next.js's client-side Router Cache can still remount this component
  // from a pre-filter render (e.g. after opening an event and returning via
  // the browser Back button). Re-parsing the live URL once after mount
  // reconciles state with what the address bar actually shows.
  useEffect(() => {
    if (!enableFilterSync) return;
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get("date");
    const fromParam = params.get("from");
    const toParam = params.get("to");
    const typeParam = params.get("type");

    if (dateParam === "today" || dateParam === "tomorrow" || dateParam === "weekend") {
      setDateFilter(dateParam);
    } else if (fromParam && toParam) {
      const start = parseIsoLocal(fromParam);
      const end = parseIsoLocal(toParam);
      if (start && end && start <= end) {
        setCalAppliedStart(start);
        setCalAppliedEnd(end);
        setCalSelectedStart(start);
        setCalSelectedEnd(end);
        setCalendarMonth(new Date(start.getFullYear(), start.getMonth(), 1));
      }
    }

    if (typeParam && EVENT_TYPE_OPTIONS.some((o) => o.value === typeParam)) {
      setActiveType(typeParam);
    }
  }, [enableFilterSync]);

  // ── Filter pipeline ───────────────────────────────────────────────────────
  // Filter-only, never sorted — `events`' input order always survives into
  // `filtered` (Array.filter is order-preserving). For a Venue-style
  // constrained/Collection caller this means "Collection Order" is the
  // default (and only) order with zero extra code: pass `events` already in
  // resolved Collection order and it stays that way through every filter.
  const filtered = events
    .filter((e) => {
      if (dateFilter === "today") return eventOccursOnDow(e, today.getDay());
      if (dateFilter === "tomorrow") return eventOccursOnDow(e, tomorrow.getDay());
      if (dateFilter === "weekend") {
        return (
          eventOccursOnDow(e, 0) || // Sunday
          eventOccursOnDow(e, 6)    // Saturday
        );
      }
      if (hasAppliedRange && calAppliedStart && calAppliedEnd) {
        return eventOccursInRange(e, calAppliedStart, calAppliedEnd);
      }
      return true;
    })
    .filter((e) => (activeType ? e.eventType === activeType : true));

  // ── Derived labels for context header ─────────────────────────────────────
  const activeDateLabel: string | null = (() => {
    if (dateFilter === "today") return "Today";
    if (dateFilter === "tomorrow") return "Tomorrow";
    if (dateFilter === "weekend") return "This Weekend";
    if (hasAppliedRange && calAppliedStart && calAppliedEnd)
      return fmtRangeLabel(calAppliedStart, calAppliedEnd);
    return null;
  })();

  const activeTypeLabel: string | null = activeType
    ? (EVENT_TYPE_OPTIONS.find((o) => o.value === activeType)?.label ?? null)
    : null;

  const hasFilters = !!(dateFilter || hasAppliedRange || activeType);

  // ── Card hover → marker highlight ─────────────────────────────────────────
  // Hover ID for events is the venue's lat,lng key (same as marker ID).
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);

  // ── Event map markers — one marker per unique venue location ─────────────
  const eventMapMarkers = useMemo<MapMarker[]>(() => {
    // Count events per venue location and keep the first representative event.
    const byKey = new Map<string, { event: WebsiteEventListItem; count: number }>();
    for (const e of filtered) {
      if (e.venueLat === null || e.venueLng === null) continue;
      const key = `${e.venueLat},${e.venueLng}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.count++;
      } else {
        byKey.set(key, { event: e, count: 1 });
      }
    }
    return Array.from(byKey.entries()).map(([key, { event: e, count }]) => {
      const subtitle = count > 1 ? `${count} events` : e.title;
      const metaLine =
        count > 1
          ? e.venueEstablishmentType || undefined
          : [e.nextOccurrenceLabel, e.venueEstablishmentType].filter(Boolean).join(" · ") || undefined;
      return {
        id: key,
        lat: e.venueLat!,
        lng: e.venueLng!,
        name: e.venueName,
        image: e.imageUrl ?? undefined,
        subtitle,
        subtitleColor: "amber" as const,
        metaLine,
      };
    });
  }, [filtered]);

  // ── Calendar chip label ───────────────────────────────────────────────────
  const calChipLabel = hasAppliedRange && calAppliedStart && calAppliedEnd
    ? fmtRangeLabel(calAppliedStart, calAppliedEnd)
    : "Calendar";

  // ── Type chip label ───────────────────────────────────────────────────────
  const typeChipLabel = activeTypeLabel ?? "Event Type";

  // ── HEADER offset — header h-16 mobile (64px) / h-[72px] desktop ─────────
  // Filter bar sticks immediately below the header on both breakpoints.
  // MAP_TOP = desktop header (72px) + filter bar (~56px) = ~128px.
  const STICKY_TOP = "top-16 md:top-[72px]";
  const MAP_TOP = "top-[128px]";
  const MAP_HEIGHT = "calc(100dvh - 128px)";

  return (
    <>
      {/* ── Sticky filter chip bar ──────────────────────────────────────── */}
      <div className={`sticky ${STICKY_TOP} z-30 bg-white border-b border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)]`}>
        {/* Chip row — overflow-visible on desktop so the calendar popover escapes */}
        <div className="flex items-center gap-2 px-4 md:px-6 py-3 overflow-x-auto md:overflow-visible [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">

          {/* Today */}
          <FilterChip
            label="Today"
            active={dateFilter === "today"}
            onClick={() => setDate("today")}
            onClear={() => setDate(null)}
          />

          {/* Tomorrow */}
          <FilterChip
            label="Tomorrow"
            active={dateFilter === "tomorrow"}
            onClick={() => setDate("tomorrow")}
            onClear={() => setDate(null)}
          />

          {/* This Weekend */}
          <FilterChip
            label="This Weekend"
            active={dateFilter === "weekend"}
            onClick={() => setDate("weekend")}
            onClear={() => setDate(null)}
          />

          {/* Calendar chip + desktop popover anchor */}
          <div className="relative flex-shrink-0">
            <FilterChip
              label={calChipLabel}
              icon={<CalendarIcon />}
              active={hasAppliedRange}
              onClick={toggleCalendar}
              onClear={clearRangeFilter}
            />

            {/* Desktop: contained popover ~390px, anchored below the chip */}
            {calendarOpen && (
              <div className="hidden md:block absolute top-full left-0 mt-2 w-[390px] rounded-2xl border border-gray-200 shadow-[0_8px_30px_rgba(0,0,0,0.12)] overflow-hidden z-30">
                <CalendarPanel
                  today={today}
                  calendarMonth={calendarMonth}
                  selectedStart={calSelectedStart}
                  selectedEnd={calSelectedEnd}
                  activeField={calActiveField}
                  onNavigateMonth={(dir) =>
                    setCalendarMonth(
                      (m) => new Date(m.getFullYear(), m.getMonth() + dir, 1)
                    )
                  }
                  onSetActiveField={setCalActiveField}
                  onDayClick={handleDayClick}
                  onApply={applyCalendar}
                  onClear={clearCalendar}
                  noBorderTop
                />
              </div>
            )}
          </div>

          {/* Event Type */}
          <FilterChip
            label={typeChipLabel}
            chevron
            active={!!activeType}
            open={typeOpen}
            onClick={toggleTypePanel}
            onClear={() => selectType(null)}
          />
        </div>

        {/* Mobile: calendar panel full-width below the chip row */}
        {calendarOpen && (
          <div className="md:hidden">
            <CalendarPanel
              today={today}
              calendarMonth={calendarMonth}
              selectedStart={calSelectedStart}
              selectedEnd={calSelectedEnd}
              activeField={calActiveField}
              onNavigateMonth={(dir) =>
                setCalendarMonth(
                  (m) => new Date(m.getFullYear(), m.getMonth() + dir, 1)
                )
              }
              onSetActiveField={setCalActiveField}
              onDayClick={handleDayClick}
              onApply={applyCalendar}
              onClear={clearCalendar}
            />
          </div>
        )}

        {/* Event type panel — expands the sticky bar */}
        {typeOpen && (
          <EventTypePanel activeType={activeType} onSelect={selectType} />
        )}
      </div>

      {/* ── Desktop: 50/50 split ────────────────────────────────────────── */}
      <div className="hidden md:flex">
        {/* Results column */}
        <div className="w-1/2 min-h-[calc(100dvh-128px)] border-r border-gray-100 px-5 pt-8 pb-10">
          <div className="mb-7">
            {contextHeader ?? (
              <EventSearchContextHeader
                market={market}
                totalCount={events.length}
                filteredCount={filtered.length}
                activeDateLabel={activeDateLabel}
                activeTypeLabel={activeTypeLabel}
              />
            )}
          </div>

          {filtered.length === 0 ? (
            <EmptyState hasFilters={hasFilters} />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {filtered.map((event) => {
                const hoverKey =
                  event.venueLat !== null && event.venueLng !== null
                    ? `${event.venueLat},${event.venueLng}`
                    : null;
                return (
                  <div
                    key={event.id}
                    onMouseEnter={() => hoverKey && setHoveredCardId(hoverKey)}
                    onMouseLeave={() => setHoveredCardId(null)}
                  >
                    <EventSearchCard event={event} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Map column — sticky */}
        <div className="w-1/2">
          <div
            className={`sticky ${MAP_TOP} flex p-4`}
            style={{ height: MAP_HEIGHT }}
          >
            <SearchResultsMap
              markers={eventMapMarkers}
              marketCenter={market.mapCenter}
              marketZoom={market.mapZoom}
              className="flex-1 rounded-2xl overflow-hidden"
              hoveredMarkerId={hoveredCardId}
            />
          </div>
        </div>
      </div>

      {/* ── Mobile: stacked layout ──────────────────────────────────────── */}
      <div className="md:hidden">
        <div className="px-4 pt-6 pb-5 border-b border-gray-100">
          {contextHeader ?? (
            <EventSearchContextHeader
              market={market}
              totalCount={events.length}
              filteredCount={filtered.length}
              activeDateLabel={activeDateLabel}
              activeTypeLabel={activeTypeLabel}
            />
          )}
        </div>

        <SearchResultsMap
          markers={eventMapMarkers}
          marketCenter={market.mapCenter}
          marketZoom={market.mapZoom}
          className="mx-4 my-4 h-52 rounded-2xl overflow-hidden"
        />

        {/* Results */}
        {filtered.length === 0 ? (
          <EmptyState hasFilters={hasFilters} />
        ) : (
          <div className="px-4 pb-8 space-y-4">
            {filtered.map((event) => (
              <EventSearchCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>

      {footerCta}
    </>
  );
}
