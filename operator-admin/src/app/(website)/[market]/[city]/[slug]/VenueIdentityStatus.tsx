"use client";

import { useState, useEffect } from "react";
import {
  computeBusinessHoursStatus,
  computeHhStatus,
  type HhSchedule,
} from "@/lib/happyHourStatus";
import { displayDayAndTime, type TimeDisplay } from "@/lib/venueTimeDisplay";
import { useVenueTimeDisplay } from "@/app/(website)/useVenueTimeDisplay";

/**
 * Open Now from the venue's own business hours at this instant, in the
 * venue's timezone (never the visitor's clock) — the same engine as Happy
 * Hour (src/lib/happyHourStatus.ts), so overnight hours work too.
 */
function getOpenStatus(hoursWeekly: Record<string, string>, timeZone: string): "Open Now" | "Closed" {
  return computeBusinessHoursStatus(hoursWeekly, timeZone).type === "open" ? "Open Now" : "Closed";
}

type HhPill =
  | { label: string; isActive: true }
  | { label: string; isActive: false; isSoon: boolean };

function getHhPill(schedule: HhSchedule, display: TimeDisplay): HhPill | null {
  const status = computeHhStatus(schedule);
  if (status.type === "active") {
    return { label: `Happy Hour · ${status.endsIn}`, isActive: true };
  }
  if (status.type === "upcoming") {
    // Converted to the visitor's clock (with its own day) when they're in
    // another timezone — see src/lib/venueTimeDisplay.ts.
    const { day, time } = displayDayAndTime(display, status.startsAtMs, {
      day: status.day,
      time: status.startsAt,
    });
    const label = day === "Today" ? `Happy Hour Today · ${time}` : `Happy Hour ${day}`;
    return { label, isActive: false, isSoon: day === "Today" };
  }
  if (status.type === "allDay") {
    return { label: `Happy Hour ${status.day} · All Day`, isActive: false, isSoon: false };
  }
  return null;
}

type Props = {
  hhSchedule: HhSchedule;
  hoursWeekly: Record<string, string>;
};

export function VenueIdentityStatus({ hhSchedule, hoursWeekly }: Props) {
  const [openStatus, setOpenStatus] = useState<"Open Now" | "Closed" | null>(null);
  const [hhPill, setHhPill] = useState<HhPill | null>(null);
  const [mounted, setMounted] = useState(false);
  const display = useVenueTimeDisplay(hhSchedule.timeZone);

  useEffect(() => {
    if (!display) return;
    setOpenStatus(getOpenStatus(hoursWeekly, hhSchedule.timeZone));
    setHhPill(getHhPill(hhSchedule, display));
    setMounted(true);
  }, [hoursWeekly, hhSchedule, display]);

  if (!mounted) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      {openStatus && (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            openStatus === "Open Now"
              ? "bg-green-50 text-green-700"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              openStatus === "Open Now" ? "bg-green-500" : "bg-gray-400"
            }`}
          />
          {openStatus}
        </span>
      )}

      {hhPill && (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
            hhPill.isActive
              ? "bg-amber-50 text-amber-700"
              : hhPill.isSoon
              ? "bg-amber-50/60 text-amber-600"
              : "bg-gray-50 text-gray-500"
          }`}
        >
          {hhPill.isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          )}
          {hhPill.label}
        </span>
      )}
    </div>
  );
}
