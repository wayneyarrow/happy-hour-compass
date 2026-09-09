/**
 * Consumer-facing Daily Special schedule/time label formatting — shared by
 * the website Daily Specials search results page and the venue detail
 * page (both live under (website)/).
 *
 * Deliberately NOT importing from src/app/admin/daily-specials/summaryLabels.ts:
 * that module is Operator Admin's own presentation layer, and per this
 * project's layering rules (see CLAUDE.md's "Public Website" vs "Operator
 * Admin" separation) a consumer page must not import UI-adjacent code from
 * an admin route. What IS shared is the underlying pure, framework-agnostic
 * logic in src/lib/dailySpecialSchedule.ts (formatDaysOfWeek, etc.) — that
 * file already lives in the shared engine layer (src/lib/), so reusing it
 * here is the correct kind of sharing, not a layering violation.
 *
 * Consumer copy intentionally differs from the Operator Admin equivalent in
 * places (e.g. Operator Admin always shows a schedule label; consumer cards
 * suppress redundant "Today" repetition — see scheduleSummaryForContext()).
 */

import { formatDaysOfWeek } from "@/lib/dailySpecialSchedule";
import type { DailySpecialSchedule, DailySpecialTime } from "@/lib/dailySpecialTypes";

// ── Date formatting ─────────────────────────────────────────────────────────

/** Parses "YYYY-MM-DD" as a LOCAL date — avoids UTC midnight shifting the day, same technique used throughout the website's date-filter code (e.g. EventSearchResults.tsx's parseIsoLocal). */
function parseDateLocal(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

/** "2026-09-18" -> "Sep 18" (no year — consumer cards favor brevity over the Operator Admin list's full "Sep 18, 2026"). */
export function formatOneTimeDateShort(isoDate: string): string {
  const d = parseDateLocal(isoDate);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

// ── Time formatting ─────────────────────────────────────────────────────────

/** "16:00" / "16:00:00" -> "4 PM" / "4:30 PM". */
export function formatClockTime(time: string): string {
  const [hStr, mStr] = time.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  const ampm = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** Same as formatClockTime() but without the AM/PM suffix — for the start half of a same-period range, e.g. "4" in "4-9 PM". */
function formatClockTimeNoSuffix(time: string): string {
  const [hStr, mStr] = time.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}` : `${h}:${String(m).padStart(2, "0")}`;
}

function periodOf(time: string): "AM" | "PM" {
  return parseInt(time.split(":")[0], 10) >= 12 ? "PM" : "AM";
}

/**
 * "" (no specific time) | "All Day" | "4-9 PM" | "From 4 PM" | "Until 1 PM"
 * | "4 PM-Close" | "Until Close". Never resolves Close to a clock time.
 *
 * A fixed start+end range sharing the same AM/PM period collapses to a
 * single shared suffix ("4-9 PM", per the product brief's exact example)
 * rather than repeating it on both sides ("4 PM-9 PM", which is what
 * Operator Admin's own list-summary format uses) — deliberately different
 * consumer copy, not a bug relative to the admin convention. Falls back to
 * a suffix on each side only for the rare case for a range crossing
 * AM/PM (which never happens for a same-day timed special in practice
 * given HHC's product shape, but is handled safely regardless).
 *
 * Consumer copy also omits "No specific time" entirely (returns "") rather
 * than showing Operator Admin's explicit label — a card with nothing to
 * say about time shouldn't say so out loud; callers simply skip rendering
 * the time line when this returns "".
 */
export function formatDailySpecialTime(time: DailySpecialTime): string {
  if (time.timeMode === "unspecified") return "";
  if (time.timeMode === "all_day") return "All Day";

  const start = time.startTime ? formatClockTime(time.startTime) : null;

  if (time.endMode === "close") {
    return start ? `${start}-Close` : "Until Close";
  }
  if (time.endMode === "time" && time.endTime) {
    const end = formatClockTime(time.endTime);
    if (!time.startTime) return `Until ${end}`;
    if (periodOf(time.startTime) === periodOf(time.endTime)) {
      return `${formatClockTimeNoSuffix(time.startTime)}-${end}`;
    }
    return `${start}-${end}`;
  }
  return start ? `From ${start}` : "";
}

// ── Schedule formatting ──────────────────────────────────────────────────────

/**
 * "Sep 18" (one-time) | "Every Wednesday" | "Monday-Friday" |
 * "Tuesday & Thursday" | "Every day" (weekly). Reuses formatDaysOfWeek()
 * (src/lib/dailySpecialSchedule.ts) for the consecutive-run collapsing —
 * the exact same weekday-range logic Operator Admin's list uses, just
 * composed into consumer-appropriate sentences here.
 */
export function formatDailySpecialSchedule(schedule: DailySpecialSchedule): string {
  if (schedule.scheduleType === "one_time") {
    return schedule.oneTimeDate ? formatOneTimeDateShort(schedule.oneTimeDate) : "";
  }
  if (schedule.daysOfWeek.length === 7) return "Every day";
  const days = formatDaysOfWeek(schedule.daysOfWeek, "long");
  return schedule.daysOfWeek.length === 1 ? `Every ${days}` : days;
}

/**
 * Schedule label for a card/detail view already known to be showing this
 * Special specifically BECAUSE it's valid "today" (e.g. the results page
 * is filtered to Today, or a future homepage rail). Avoids the redundant
 * "Today · Every Wednesday · Wednesday" pattern the task brief calls out —
 * when the context is already "today", a single-day weekly schedule adds
 * no information a plain "Today" doesn't already say. Multi-day schedules
 * still show their fuller label (e.g. "Monday-Friday") since that
 * communicates something "Today" alone doesn't (that it also runs on
 * other days) — the full label wins there, judgement call rather than
 * hard rule.
 */
export function scheduleSummaryForContext(
  schedule: DailySpecialSchedule,
  context: "today" | "browse"
): string {
  if (context !== "today") return formatDailySpecialSchedule(schedule);
  if (schedule.scheduleType === "weekly" && schedule.daysOfWeek.length === 1) {
    return "Today";
  }
  return formatDailySpecialSchedule(schedule);
}
