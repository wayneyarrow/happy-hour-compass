"use client";

import { useEffect, useState } from "react";
import { getSessionId } from "@/lib/trackingSession";
import {
  buildBusinessHoursSchedule,
  computeBusinessHoursStatus,
} from "@/lib/happyHourStatus";
import {
  buildDisplayedWeek,
  displayCaption,
  displayDayAndTime,
  formatClockTime,
  type TimeDisplay,
} from "@/lib/venueTimeDisplay";
import { timeZoneLabel } from "@/lib/timeZones";
import { useVenueTimeDisplay } from "@/app/(website)/useVenueTimeDisplay";

const DAY_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

type HoursStatus = { status: string; text: string; isOpen: boolean };

/**
 * Open/closed line, decided from the venue's business hours in the venue's
 * own timezone at this instant (src/lib/happyHourStatus.ts); times read in
 * the visitor's clock when they're elsewhere.
 */
function describeStatus(hoursWeekly: Record<string, string>, timeZone: string, display: TimeDisplay): HoursStatus {
  const status = computeBusinessHoursStatus(hoursWeekly, timeZone);
  if (status.type === "open") {
    const closes =
      display.mode === "visitor"
        ? `${formatClockTime(status.closesAtMs, display.timeZone)} ${timeZoneLabel(display.timeZone, status.closesAtMs)}`
        : status.closesAt;
    return { status: "Open now", text: `closes at ${closes}`, isOpen: true };
  }
  if (!status.next) return { status: "Closed", text: "reopening TBD", isOpen: false };
  const { day, time } = displayDayAndTime(display, status.next.opensAtMs, {
    day: status.next.day,
    time: status.next.opensAt,
  });
  const when = day === "Today" ? `at ${time}` : day === "Tomorrow" ? `tomorrow at ${time}` : `on ${day} at ${time}`;
  return { status: "Closed", text: `opens ${when}`, isOpen: false };
}

type Props = {
  hoursWeekly: Record<string, string>;
  /** IANA timezone of the venue's market (HhSchedule.timeZone). */
  timeZone: string;
  venueId?: string;
};

/**
 * Venue page Business Hours row — the website's own copy of the consumer
 * BusinessHoursRow markup ((consumer)/event/[id]/BusinessHoursRow.tsx, left
 * untouched per the repo's import-don't-modify rule), made timezone-correct:
 * Open Now uses the venue's clock rather than the visitor's, and a visitor
 * in another timezone sees converted, labelled hours on their own weekdays.
 */
export function WebsiteBusinessHoursRow({ hoursWeekly, timeZone, venueId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<HoursStatus | null>(null);
  const display = useVenueTimeDisplay(timeZone);

  useEffect(() => {
    if (!display) return;
    setStatus(describeStatus(hoursWeekly, timeZone, display));
  }, [hoursWeekly, timeZone, display]);

  const hasWeekly = DAY_ORDER.some((d) => hoursWeekly[d]);
  const caption = display ? displayCaption(display) : null;
  const week =
    display?.mode === "visitor"
      ? buildDisplayedWeek(buildBusinessHoursSchedule(hoursWeekly, timeZone).weekly, display, {
          emptyText: "CLOSED",
        }).map((row) => ({ day: row.day, text: row.ranges.join(", ") }))
      : DAY_ORDER.map((day) => ({ day, text: hoursWeekly[day] ?? "CLOSED" }));

  return (
    <div className="py-4 border-b border-gray-100">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.8px] leading-[1.3] mb-1.5">
        Business Hours
      </p>

      {status && (
        <div className="flex items-center gap-1 min-w-0">
          <span
            className={`text-[14px] font-medium flex-shrink-0 whitespace-nowrap ${
              status.isOpen ? "text-emerald-500" : "text-red-500"
            }`}
          >
            {status.status}
          </span>
          <span className="text-[14px] font-medium text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
            · {status.text}
          </span>
          {hasWeekly && (
            <button
              onClick={() => {
                const opening = !expanded;
                setExpanded((v) => !v);
                if (opening && venueId) {
                  fetch("/api/track/venue-click", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      venueId,
                      clickType: "business_hours_expand",
                      sessionId: getSessionId(),
                    }),
                  }).catch(() => {});
                }
              }}
              className="inline-flex items-center gap-1 text-[13px] text-blue-500 font-medium ml-auto flex-shrink-0 whitespace-nowrap hover:text-blue-600"
            >
              <span className={`text-[10px] transition-transform duration-200 inline-block ${expanded ? "rotate-180" : ""}`}>
                ▾
              </span>
              <span>{expanded ? "Hide full hours" : "Show full hours"}</span>
            </button>
          )}
        </div>
      )}

      {status && caption && (
        <p className="text-[12px] text-gray-400 mt-1" data-testid="business-hours-time-zone-caption">
          {caption}
        </p>
      )}

      {hasWeekly && expanded && (
        <div className="mt-3 flex flex-col gap-2">
          {week.map(({ day, text }) => (
            <div key={day} className="flex justify-between text-[14px]">
              <span className="font-semibold text-[#374151]">{day}</span>
              <span className="text-gray-600">{text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
