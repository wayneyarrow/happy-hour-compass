"use client";

import { useState, useEffect } from "react";
import { computeHhStatus } from "@/lib/happyHourStatus";

type HHSlot = { start: string; end: string };

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

function parseAmPm(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function getOpenStatus(hoursWeekly: Record<string, string>): "Open Now" | "Closed" | null {
  const now = new Date();
  const entry = hoursWeekly[DAYS[now.getDay()]];
  if (!entry || entry === "CLOSED") return "Closed";
  const parts = entry.split(" - ");
  if (parts.length !== 2) return null;
  const open = parseAmPm(parts[0]);
  const close = parseAmPm(parts[1]);
  if (open === null || close === null || close <= open) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= open && nowMin < close ? "Open Now" : "Closed";
}

type HhPill =
  | { label: string; isActive: true }
  | { label: string; isActive: false; isSoon: boolean };

function getHhPill(weekly: Record<string, HHSlot[]>): HhPill | null {
  const status = computeHhStatus(weekly);
  if (status.type === "active") {
    return { label: `Happy Hour · ${status.endsIn}`, isActive: true };
  }
  if (status.type === "upcoming") {
    const label =
      status.day === "Today"
        ? `Happy Hour Today · ${status.startsAt}`
        : `Happy Hour ${status.day}`;
    return { label, isActive: false, isSoon: status.day === "Today" };
  }
  return null;
}

type Props = {
  happyHourWeekly: Record<string, HHSlot[]>;
  hoursWeekly: Record<string, string>;
};

export function VenueIdentityStatus({ happyHourWeekly, hoursWeekly }: Props) {
  const [openStatus, setOpenStatus] = useState<"Open Now" | "Closed" | null>(null);
  const [hhPill, setHhPill] = useState<HhPill | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setOpenStatus(getOpenStatus(hoursWeekly));
    setHhPill(getHhPill(happyHourWeekly));
    setMounted(true);
  }, [hoursWeekly, happyHourWeekly]);

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
