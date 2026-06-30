"use client";

import { useState } from "react";

const DAY_ORDER = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

type Props = {
  hoursWeekly: Record<string, string>;
  /** Day name of the event ("Tuesday") — this row is always emphasised. */
  eventDayName: string | null;
  /** Day name for today ("Tuesday") — shown with "(Today)" annotation. */
  todayDayName: string | null;
};

export function BusinessHoursPanel({ hoursWeekly, eventDayName, todayDayName }: Props) {
  const [expanded, setExpanded] = useState(false);

  const openDays = DAY_ORDER.filter(
    (d) => hoursWeekly[d] && hoursWeekly[d] !== "CLOSED"
  );

  if (openDays.length === 0) return null;

  const eventDayHours =
    eventDayName && hoursWeekly[eventDayName] !== "CLOSED"
      ? hoursWeekly[eventDayName]
      : null;

  const isEventDayToday = eventDayName !== null && eventDayName === todayDayName;

  return (
    <div className="space-y-2">
      {/* Summary row — event day + expand toggle */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {eventDayHours ? (
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-semibold text-gray-900">
                {eventDayName}
                {isEventDayToday && (
                  <span className="ml-1 text-[11px] font-normal text-amber-700">(Today)</span>
                )}
              </span>
              <span className="text-[13px] text-gray-600">{eventDayHours}</span>
            </div>
          ) : (
            <span className="text-[13px] text-gray-500 italic">
              {eventDayName ? `Closed on ${eventDayName}s` : "Hours available below"}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 flex items-center gap-1 text-[12px] font-semibold text-amber-700 hover:text-amber-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
          aria-expanded={expanded}
        >
          <span>{expanded ? "Hide hours" : "View all hours"}</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`w-3 h-3 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* Expanded: full weekly schedule */}
      {expanded && (
        <div className="space-y-0.5 pt-1">
          {openDays.map((d) => {
            const isEvent = d === eventDayName;
            return (
              <div
                key={d}
                className={`flex justify-between gap-4 text-[13px] ${
                  isEvent
                    ? "font-semibold text-gray-900"
                    : "text-gray-500"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {d.slice(0, 3)}
                  {isEvent && isEventDayToday && (
                    <span className="text-[10px] font-normal text-amber-700">(Today)</span>
                  )}
                </span>
                <span className={isEvent ? "text-gray-900" : "text-gray-700"}>
                  {hoursWeekly[d]}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
