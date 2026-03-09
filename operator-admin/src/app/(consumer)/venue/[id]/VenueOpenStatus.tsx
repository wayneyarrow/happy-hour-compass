"use client";

import { useEffect, useState } from "react";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Parses "H:MM AM" / "H:MM PM" to minutes since midnight. Returns null if unparseable. */
function parseAmPm(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

/**
 * Returns "Open Now", "Closed", or null.
 * null means the hours data is missing or unparseable — caller should fall
 * back to "Hours Available".
 */
function getOpenStatus(
  hoursWeekly: Record<string, string>
): "Open Now" | "Closed" | null {
  const now = new Date();
  const dayName = DAYS[now.getDay()];
  const entry = hoursWeekly[dayName];

  if (!entry || entry === "CLOSED") return "Closed";

  const parts = entry.split(" - ");
  if (parts.length !== 2) return null;

  const open = parseAmPm(parts[0]);
  const close = parseAmPm(parts[1]);

  // Require both times parseable and a sensible same-day range.
  if (open === null || close === null || close <= open) return null;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= open && nowMin < close ? "Open Now" : "Closed";
}

type Props = {
  hoursWeekly: Record<string, string>;
};

/**
 * Displays whether the venue is currently open based on its business hours.
 * Determined client-side using the browser's current time.
 * Falls back to "Hours Available" if hours data is incomplete or unparseable.
 */
export function VenueOpenStatus({ hoursWeekly }: Props) {
  const [status, setStatus] = useState<string>("Hours Available");

  useEffect(() => {
    const result = getOpenStatus(hoursWeekly);
    setStatus(result ?? "Hours Available");
  }, [hoursWeekly]);

  return <>{status}</>;
}
