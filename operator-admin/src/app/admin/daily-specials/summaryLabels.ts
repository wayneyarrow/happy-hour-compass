/**
 * Human-readable schedule/time summary labels for the Daily Specials list
 * and form preview — pure, no I/O, directly unit-testable.
 *
 * Builds on the Phase 1 pure helpers (src/lib/dailySpecialSchedule.ts)
 * rather than re-deriving weekday/range logic here — see formatDaysOfWeek()
 * for the consecutive-run collapsing (e.g. Monday-Friday) reused below.
 */

import { formatDaysOfWeek } from "@/lib/dailySpecialSchedule";
import type { DailySpecialSchedule, DailySpecialTime } from "@/lib/dailySpecialTypes";

// ── Date formatting ─────────────────────────────────────────────────────────

/** Parses "YYYY-MM-DD" as a LOCAL date — avoids UTC midnight shifting the day, same technique as EventForm.tsx's parseDateLocal(). */
function parseDateLocal(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

/** "2026-09-18" -> "Sep 18, 2026" */
export function formatDateLong(isoDate: string): string {
  const d = parseDateLocal(isoDate);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

// ── Time formatting ─────────────────────────────────────────────────────────

/** "16:00" or "16:00:00" (real TIME column value) -> "4 PM" / "4:30 PM". Mirrors hhmmTo12hDisplay() in src/lib/data/events.ts / src/lib/data/venues.ts. */
export function formatClockTime(time: string): string {
  const [hStr, mStr] = time.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  const ampm = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

// ── Schedule summary ─────────────────────────────────────────────────────────

/**
 * One-time -> "Sep 18, 2026"
 * Weekly, single day -> "Every Wednesday"
 * Weekly, consecutive run -> "Monday-Friday"
 * Weekly, irregular days -> "Tuesday & Thursday"
 * Weekly, all 7 days -> "Every day"
 */
export function scheduleSummary(schedule: DailySpecialSchedule): string {
  if (schedule.scheduleType === "one_time") {
    return schedule.oneTimeDate ? formatDateLong(schedule.oneTimeDate) : "No date set";
  }
  if (schedule.daysOfWeek.length === 7) return "Every day";
  const days = formatDaysOfWeek(schedule.daysOfWeek, "long");
  return schedule.daysOfWeek.length === 1 ? `Every ${days}` : days;
}

/**
 * Optional validity-range summary for a weekly special. Returns null when
 * there is nothing to show (no start/end boundary at all — the common
 * case for an open-ended weekly special).
 */
export function validitySummary(schedule: DailySpecialSchedule): string | null {
  if (schedule.scheduleType !== "weekly") return null;
  const { recurrenceStartDate, recurrenceEndDate } = schedule;
  if (!recurrenceStartDate && !recurrenceEndDate) return null;

  const start = recurrenceStartDate ? formatDateLong(recurrenceStartDate) : null;
  const end = recurrenceEndDate ? formatDateLong(recurrenceEndDate) : null;

  if (start && end) return `${start} – ${end}`;
  if (start) return `Starting ${start}`;
  return `Through ${end}`;
}

// ── Time summary ─────────────────────────────────────────────────────────────

/**
 * "No specific time" | "All Day" | "4 PM-9 PM" | "From 4 PM" | "Until 1 PM"
 * | "4 PM-Close" | "Until Close". Never resolves Close against venue hours
 * — "Close" always renders as the literal word.
 */
export function timeSummary(time: DailySpecialTime): string {
  if (time.timeMode === "unspecified") return "No specific time";
  if (time.timeMode === "all_day") return "All Day";

  // timed
  const start = time.startTime ? formatClockTime(time.startTime) : null;

  if (time.endMode === "close") {
    return start ? `${start}-Close` : "Until Close";
  }
  if (time.endMode === "time" && time.endTime) {
    const end = formatClockTime(time.endTime);
    return start ? `${start}-${end}` : `Until ${end}`;
  }
  // endMode === "unspecified" — start-only ("From 4 PM"). validateDailySpecialTime
  // guarantees start is present whenever timeMode="timed" and endMode="unspecified".
  return start ? `From ${start}` : "No specific time";
}
