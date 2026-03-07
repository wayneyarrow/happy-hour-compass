"use client";

import { useState } from "react";
import type { ConsumerEventListItem } from "@/lib/data/events";
import { EventCard } from "./EventCard";

// ─── Calendar helpers ─────────────────────────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function todayDate(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtFieldDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function thisWeekendIsos(): string[] {
  const today = new Date();
  const dow = today.getDay();
  const offset = (n: number) => {
    const dt = new Date(today);
    dt.setDate(today.getDate() + n);
    return toIso(dt);
  };
  if (dow === 6) return [offset(0), offset(1)];
  if (dow === 0) return [offset(-1), offset(0)];
  return [offset(6 - dow), offset(7 - dow)];
}

/** Ordered grid cells for the calendar month. null = empty leading cell. */
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

// ─── Filter helper ────────────────────────────────────────────────────────────

const isRecurring = (e: ConsumerEventListItem) =>
  e.recurrence != null && e.recurrence !== "none";

// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  events: ConsumerEventListItem[];
};

export function EventsDiscovery({ events }: Props) {
  const today = todayDate();
  const todayStr = toIso(today);
  const weekendDates = thisWeekendIsos();

  // ── Search (hidden by default, toggled by header icon) ────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  function toggleSearch() {
    if (searchOpen) {
      // Closing — clear term (matches original toggleEventsSearch behavior)
      setSearchTerm("");
    }
    setSearchOpen((v) => !v);
  }

  // ── Filter chips ────────────────────────────────────────────────────────────
  const [happeningTodayActive, setHappeningTodayActive] = useState(false);
  const [thisWeekendActive, setThisWeekendActive] = useState(false);

  // ── Calendar state ──────────────────────────────────────────────────────────
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [calSelectedStart, setCalSelectedStart] = useState<Date | null>(null);
  const [calSelectedEnd, setCalSelectedEnd] = useState<Date | null>(null);
  const [calAppliedStart, setCalAppliedStart] = useState<Date | null>(null);
  const [calAppliedEnd, setCalAppliedEnd] = useState<Date | null>(null);
  const [calActiveField, setCalActiveField] = useState<"from" | "to">("from");

  function toggleCalendar() {
    if (calendarOpen) {
      // Closing without applying — discard unsaved changes (matches original)
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

  function navigateMonth(dir: -1 | 1) {
    setCalendarMonth((m) => new Date(m.getFullYear(), m.getMonth() + dir, 1));
  }

  function handleDayClick(date: Date) {
    if (date < today && !sameDay(date, today)) return; // past = disabled
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

  function applyCalendarRange() {
    if (!calSelectedStart || !calSelectedEnd) return;
    setCalAppliedStart(calSelectedStart);
    setCalAppliedEnd(calSelectedEnd);
    setCalendarOpen(false);
    // TODO: wire applied range into event filter pipeline
  }

  function clearCalendarRange() {
    setCalSelectedStart(null);
    setCalSelectedEnd(null);
    setCalAppliedStart(null);
    setCalAppliedEnd(null);
    setCalendarOpen(false);
    // TODO: clear date filter from event filter pipeline
  }

  function getDayState(
    date: Date
  ): "disabled" | "range-start" | "range-end" | "in-range" | "today" | "" {
    if (date < today && !sameDay(date, today)) return "disabled";
    const isStart = calSelectedStart !== null && sameDay(date, calSelectedStart);
    const isEnd = calSelectedEnd !== null && sameDay(date, calSelectedEnd);
    if (isStart) return "range-start";
    if (isEnd) return "range-end";
    if (
      calSelectedStart !== null &&
      calSelectedEnd !== null &&
      date > calSelectedStart &&
      date < calSelectedEnd
    )
      return "in-range";
    if (sameDay(date, today)) return "today";
    return "";
  }

  const hasAppliedRange = calAppliedStart !== null;

  const prevMonthDisabled =
    calendarMonth.getFullYear() === today.getFullYear() &&
    calendarMonth.getMonth() === today.getMonth();

  // ── Filter pipeline ────────────────────────────────────────────────────────
  const filtered = events
    .filter((e) =>
      searchTerm
        ? e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          e.venueName.toLowerCase().includes(searchTerm.toLowerCase())
        : true
    )
    .filter((e) =>
      happeningTodayActive ? isRecurring(e) || e.firstDate === todayStr : true
    )
    .filter((e) =>
      thisWeekendActive
        ? isRecurring(e) ||
          (e.firstDate != null && weekendDates.includes(e.firstDate))
        : true
    );

  const anyFilterActive =
    happeningTodayActive || thisWeekendActive || hasAppliedRange || !!searchTerm;

  const calendarCells = buildCalendarCells(calendarMonth);

  return (
    <>
      {/* ── Sticky page header — matches original .page-header.sticky ───── */}
      <div className="sticky top-0 z-50 bg-white border-b border-gray-200 px-5 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-900">Events</h1>
        {/* Search toggle button — matches original .search-toggle-btn */}
        <button
          type="button"
          onClick={toggleSearch}
          aria-label={searchOpen ? "Close search" : "Search events"}
          className="w-8 h-8 flex items-center justify-center rounded-full text-blue-500 hover:bg-gray-100 transition-colors"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>
      </div>

      {/* ── Search container (collapsible) — matches original .search-container ── */}
      {searchOpen && (
        <div className="sticky top-[57px] z-[49] bg-white px-5 pt-3 pb-4 border-b border-gray-200">
          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              placeholder="Search events..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
          </div>
        </div>
      )}

      {/* ── Filter section — matches original .filter-section ─────────────── */}
      <div>
        {/* Label row with calendar button — matches original inner flex row */}
        <div className="flex justify-between items-center px-5 pt-3 pb-1.5">
          <p className="text-xs font-semibold uppercase tracking-[0.5px] text-gray-500">
            Filter events
          </p>
          {/* Calendar button — matches original .calendar-btn */}
          <button
            type="button"
            onClick={toggleCalendar}
            title="Select date"
            aria-label="Filter by date range"
            className={`flex items-center justify-center rounded-lg p-2 border shrink-0 ml-2 transition-colors ${
              hasAppliedRange || calendarOpen
                ? "border-sky-500 bg-sky-50"
                : "border-gray-300 bg-white hover:bg-gray-50 hover:border-gray-400"
            }`}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke={hasAppliedRange || calendarOpen ? "#0284c7" : "#6b7280"}
              strokeWidth="2"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
        </div>

        {/* Filter chips row — matches original .filters */}
        <div className="flex gap-2.5 px-5 pb-4 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {(
            [
              {
                label: "Happening Today",
                active: happeningTodayActive,
                toggle: () => setHappeningTodayActive((v) => !v),
              },
              {
                label: "This Weekend",
                active: thisWeekendActive,
                toggle: () => setThisWeekendActive((v) => !v),
              },
            ] as const
          ).map(({ label, active, toggle }) => (
            <button
              key={label}
              type="button"
              onClick={toggle}
              className={`rounded-full px-4 py-2 whitespace-nowrap text-sm font-medium shrink-0 shadow-sm transition-all ${
                active
                  ? "bg-blue-500 text-white border-2 border-blue-500 font-semibold shadow-[0_2px_4px_rgba(59,130,246,0.3)]"
                  : "bg-white text-gray-700 border-2 border-gray-300 hover:border-gray-400 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Calendar picker panel — matches original .custom-calendar-container ── */}
      {calendarOpen && (
        <div className="bg-white border-b border-gray-200 px-5 py-4">
          {/* From / To date fields — matches .calendar-from-to-fields + .date-field */}
          <div className="flex gap-3 mb-3 pb-3 border-b border-gray-200">
            {(["from", "to"] as const).map((field) => {
              const date = field === "from" ? calSelectedStart : calSelectedEnd;
              const isActive = calActiveField === field;
              return (
                <button
                  key={field}
                  type="button"
                  onClick={() => setCalActiveField(field)}
                  className={`flex-1 px-3 py-2.5 border-2 rounded-lg text-left transition-all ${
                    isActive
                      ? "border-sky-500 bg-sky-50"
                      : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {/* .date-field-label */}
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                    {field === "from" ? "From" : "To"}
                  </p>
                  {/* .date-field-value */}
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

          {/* Helper text — matches .calendar-helper-text */}
          <p className="text-xs text-gray-500 text-center bg-gray-50 rounded-md px-3 py-2 mb-3">
            {calActiveField === "from"
              ? "Select a start date"
              : "Select an end date"}
          </p>

          {/* Month navigation — matches .calendar-header */}
          <div className="flex justify-between items-center mb-3">
            <button
              type="button"
              onClick={() => navigateMonth(-1)}
              disabled={prevMonthDisabled}
              aria-label="Previous month"
              className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="text-[15px] font-semibold text-gray-900">
              {MONTHS[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => navigateMonth(1)}
              aria-label="Next month"
              className="w-8 h-8 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {/* Weekday headers — matches .calendar-weekdays */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="text-center text-[11px] font-semibold text-gray-500 py-2"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid — matches .calendar-grid + .calendar-day states */}
          <div className="grid grid-cols-7 gap-1 mb-4">
            {calendarCells.map((date, i) => {
              if (!date) return <div key={`e-${i}`} />;
              const state = getDayState(date);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={state === "disabled"}
                  onClick={() => handleDayClick(date)}
                  className={[
                    "aspect-square flex items-center justify-center text-sm font-medium rounded-lg border transition-all",
                    state === "disabled"
                      ? "text-gray-300 bg-gray-50 border-transparent cursor-not-allowed"
                      : state === "range-start" || state === "range-end"
                      ? "bg-sky-600 text-white border-sky-600 font-semibold"
                      : state === "in-range"
                      ? "bg-sky-100 text-sky-900 border-sky-200"
                      : state === "today"
                      ? "text-sky-600 font-bold border-transparent hover:bg-gray-100"
                      : "text-gray-900 border-transparent hover:bg-gray-100 hover:border-gray-200",
                  ].join(" ")}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          {/* Action buttons — matches .calendar-actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={applyCalendarRange}
              disabled={!calSelectedStart || !calSelectedEnd}
              className="flex-1 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={clearCalendarRange}
              className="flex-1 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── Content area ─────────────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        <p className="text-sm font-semibold text-gray-700 mb-4">All Events</p>

        {filtered.length === 0 ? (
          /* Empty state — matches original: 🎉 icon, "No events found" */
          <div className="flex flex-col items-center justify-center text-center py-16 px-10">
            <div className="text-5xl opacity-50 mb-4">🎉</div>
            <p className="text-lg font-semibold text-gray-700 mb-2">
              No events found
            </p>
            <p className="text-sm text-gray-500">
              {anyFilterActive
                ? "Try adjusting your filters or check back later for new events."
                : "Check back soon — events will appear here."}
            </p>
          </div>
        ) : (
          <ul className="space-y-px">
            {filtered.map((event) => (
              <li key={event.id}>
                <EventCard event={event} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
