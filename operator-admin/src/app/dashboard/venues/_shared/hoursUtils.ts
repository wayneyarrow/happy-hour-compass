import type { DayOfWeek } from "./types";

/** Ordered array of every day of the week (Mon → Sun). */
export const DAYS_OF_WEEK: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** Human-readable label for each day. */
export const DAY_LABELS: Record<DayOfWeek, string> = {
  monday:    "Monday",
  tuesday:   "Tuesday",
  wednesday: "Wednesday",
  thursday:  "Thursday",
  friday:    "Friday",
  saturday:  "Saturday",
  sunday:    "Sunday",
};

/**
 * Converts 12-hour UI components to a 24-hour "HH:MM" string.
 *
 * @param hour   "1"–"12"
 * @param minute "00" | "15" | "30" | "45"
 * @param period "AM" | "PM"
 */
export function to24h(hour: string, minute: string, period: string): string {
  let h = parseInt(hour, 10);
  if (period === "AM") {
    // 12 AM  →  00:xx
    if (h === 12) h = 0;
  } else {
    // 12 PM stays 12; 1–11 PM → 13–23
    if (h !== 12) h += 12;
  }
  return `${String(h).padStart(2, "0")}:${minute}`;
}

/**
 * Converts a 24-hour "HH:MM" string to 12-hour UI components.
 *
 * @param time24 e.g. "14:30"
 * @returns { hour: "2", minute: "30", period: "PM" }
 */
export function to12h(time24: string): {
  hour: string;
  minute: string;
  period: "AM" | "PM";
} {
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const period: "AM" | "PM" = h < 12 ? "AM" : "PM";
  if (h === 0) h = 12;       // 00:xx → 12 AM
  else if (h > 12) h -= 12;  // 13–23 → 1–11 PM
  return { hour: String(h), minute: mStr, period };
}
