"use client";

import { useState, useEffect } from "react";

const DAY_ORDER = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type HoursStatus = {
  status: string;
  text: string;
  isOpen: boolean;
};

/**
 * Parses a business hours string like "4 PM – 10 PM" or "4:30 PM – 10:30 PM"
 * into open/close minute values. Handles en dash and regular dash separators.
 * Returns null for CLOSED entries or unparseable strings.
 */
function parseHoursStr(
  hoursStr: string | undefined
): {
  open: number;
  close: number;
  openStr: string;
  closeStr: string;
  isOvernight: boolean;
} | null {
  if (!hoursStr || hoursStr === "CLOSED" || hoursStr === "Closed") return null;

  // Handles optional :MM — e.g. "4 PM – 10 PM" and "4:30 PM – 10:00 PM"
  // Separators: regular dash, en dash (–), or Unicode en dash (\u2013)
  const match = hoursStr.match(
    /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[-\u2013–]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i
  );
  if (!match) return null;

  let openHour = parseInt(match[1], 10);
  const openMin = parseInt(match[2] ?? "0", 10);
  const openPeriod = match[3].toUpperCase();
  let closeHour = parseInt(match[4], 10);
  const closeMin = parseInt(match[5] ?? "0", 10);
  const closePeriod = match[6].toUpperCase();

  if (openPeriod === "PM" && openHour !== 12) openHour += 12;
  if (openPeriod === "AM" && openHour === 12) openHour = 0;
  if (closePeriod === "PM" && closeHour !== 12) closeHour += 12;
  if (closePeriod === "AM" && closeHour === 12) closeHour = 0;

  let openMinutes = openHour * 60 + openMin;
  let closeMinutes = closeHour * 60 + closeMin;

  // "12:00 AM" as close = end-of-day
  if (closeMinutes === 0 && openMinutes > 0) closeMinutes = 1440;
  // Overnight hours cross midnight
  if (closeMinutes <= openMinutes && closeMinutes !== 1440) closeMinutes += 1440;

  // Build human-readable time strings matching original format
  const openStr = match[2] ? `${match[1]}:${match[2]} ${match[3]}` : `${match[1]} ${match[3]}`;
  const closeStr = match[5] ? `${match[4]}:${match[5]} ${match[6]}` : `${match[4]} ${match[6]}`;

  return {
    open: openMinutes,
    close: closeMinutes,
    openStr,
    closeStr,
    isOvernight: closeMinutes > 1440,
  };
}

/** Mirrors calculateBusinessHoursStatus() from the original app's index.html. */
function calculateBusinessHoursStatus(
  hoursWeekly: Record<string, string>
): HoursStatus {
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday
  const currentTime = now.getHours() * 60 + now.getMinutes();
  const dayNames = DAY_ORDER as unknown as string[];
  const todayName = dayNames[currentDay];

  const today = parseHoursStr(hoursWeekly[todayName]);

  if (!today) {
    // Today is CLOSED — find next opening
    for (let i = 1; i <= 7; i++) {
      const nextDayName = dayNames[(currentDay + i) % 7];
      const next = parseHoursStr(hoursWeekly[nextDayName]);
      if (next) {
        return {
          status: "Closed",
          text: `opens ${i === 1 ? "tomorrow at" : "on " + nextDayName + " at"} ${next.openStr}`,
          isOpen: false,
        };
      }
    }
    return { status: "Closed", text: "reopening TBD", isOpen: false };
  }

  // Check if still open from yesterday's overnight hours
  const yesterdayName = dayNames[(currentDay - 1 + 7) % 7];
  const yesterday = parseHoursStr(hoursWeekly[yesterdayName]);
  if (yesterday?.isOvernight) {
    const spillEnd = yesterday.close - 1440;
    if (currentTime < spillEnd) {
      return { status: "Open now", text: `closes at ${yesterday.closeStr}`, isOpen: true };
    }
  }

  // Check today's window
  if (today.isOvernight) {
    if (currentTime >= today.open) {
      return { status: "Open now", text: `closes at ${today.closeStr}`, isOpen: true };
    }
    return { status: "Closed", text: `opens at ${today.openStr}`, isOpen: false };
  } else {
    if (currentTime < today.open) {
      return { status: "Closed", text: `opens at ${today.openStr}`, isOpen: false };
    } else if (currentTime <= today.close) {
      return { status: "Open now", text: `closes at ${today.closeStr}`, isOpen: true };
    } else {
      // After closing — find next opening
      for (let i = 1; i <= 7; i++) {
        const nextDayName = dayNames[(currentDay + i) % 7];
        const next = parseHoursStr(hoursWeekly[nextDayName]);
        if (next) {
          return {
            status: "Closed",
            text: `opens ${i === 1 ? "tomorrow at" : "on " + nextDayName + " at"} ${next.openStr}`,
            isOpen: false,
          };
        }
      }
      return { status: "Closed", text: "reopening TBD", isOpen: false };
    }
  }
}

type Props = {
  hoursWeekly: Record<string, string>;
};

/**
 * Business Hours info row for the event detail page.
 *
 * Matches the original app's renderEventVenueInfo() hours block:
 *  - "Open now" in green / "Closed" in red (.hours-status-badge.open / .closed)
 *  - "· closes at 10 PM" beside it (.hours-status-text)
 *  - "▾ Show full hours" toggle that expands/collapses the weekly schedule
 *  - Weekly schedule shows all 7 days (.hours-day-row)
 */
export function BusinessHoursRow({ hoursWeekly }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<HoursStatus | null>(null);

  // Calculate status client-side so it uses the browser's local time.
  useEffect(() => {
    setStatus(calculateBusinessHoursStatus(hoursWeekly));
  }, [hoursWeekly]);

  // Show all 7 days in the expanded weekly view (same as original).
  const hasWeekly = DAY_ORDER.some((d) => hoursWeekly[d]);

  return (
    <div className="py-4 border-b border-gray-100">
      {/* .info-row-label */}
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5">
        Business Hours
      </p>

      {/* .hours-status row */}
      {status && (
        <div className="flex items-center gap-1 min-w-0">
          {/* .hours-status-badge.open / .closed — 14px medium */}
          <span
            className={`text-[14px] font-medium flex-shrink-0 whitespace-nowrap ${
              status.isOpen ? "text-emerald-500" : "text-red-500"
            }`}
          >
            {status.status}
          </span>

          {/* .hours-status-text — 14px medium gray-500, no wrap, ellipsis */}
          <span className="text-[14px] font-medium text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
            · {status.text}
          </span>

          {/* .hours-toggle — blue, 13px medium, ml-auto */}
          {hasWeekly && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-[13px] text-blue-500 font-medium ml-auto flex-shrink-0 whitespace-nowrap hover:text-blue-600"
            >
              {/* .hours-disclosure — triangle rotates when expanded */}
              <span
                className={`text-[10px] transition-transform duration-200 inline-block ${
                  expanded ? "rotate-180" : ""
                }`}
              >
                ▾
              </span>
              <span>{expanded ? "Hide full hours" : "Show full hours"}</span>
            </button>
          )}
        </div>
      )}

      {/* .hours-weekly — all 7 days, .hours-day-row each 14px */}
      {hasWeekly && expanded && (
        <div className="mt-3 flex flex-col gap-2">
          {DAY_ORDER.map((day) => (
            <div key={day} className="flex justify-between text-[14px]">
              {/* .hours-day-name — 600 weight, #374151 */}
              <span className="font-semibold text-[#374151]">{day}</span>
              {/* .hours-day-time */}
              <span className="text-gray-600">
                {hoursWeekly[day] ?? "CLOSED"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
