/**
 * Deterministic display order for a venue's Daily Specials section.
 * Pure, no I/O — directly unit-testable.
 *
 * Order (per the Phase 3 task brief §13):
 *   1. Specials valid today (occursOnDate against todayIsoDate) — most
 *      immediately relevant to a visitor looking at this page right now.
 *   2. Remaining one-time Specials, soonest date first.
 *   3. Remaining weekly Specials, by their earliest selected weekday.
 *   4. Deterministic fallback: title, alphabetical.
 *
 * Not a personalized/algorithmic ranking (explicitly out of scope for this
 * phase) — just a stable, sensible reading order for a page section.
 */

import { occursOnDate } from "@/lib/dailySpecialSchedule";
import type { DailySpecial } from "@/lib/dailySpecialTypes";

function scheduleSortKey(special: DailySpecial): [number, string] {
  if (special.schedule.scheduleType === "one_time") {
    return [1, special.schedule.oneTimeDate];
  }
  // Weekly — sort by earliest selected weekday, zero-padded so it compares
  // correctly as a string alongside one-time dates' "YYYY-MM-DD" shape.
  const earliestWeekday = special.schedule.daysOfWeek[0] ?? 0;
  return [2, String(earliestWeekday).padStart(2, "0")];
}

export function sortDailySpecialsForVenueDetail(
  specials: DailySpecial[],
  todayIsoDate: string
): DailySpecial[] {
  return [...specials].sort((a, b) => {
    const aToday = occursOnDate(a.schedule, todayIsoDate);
    const bToday = occursOnDate(b.schedule, todayIsoDate);
    if (aToday !== bToday) return aToday ? -1 : 1;

    const [aBucket, aKey] = scheduleSortKey(a);
    const [bBucket, bKey] = scheduleSortKey(b);
    if (aBucket !== bBucket) return aBucket - bBucket;
    if (aKey !== bKey) return aKey < bKey ? -1 : 1;

    return a.title.localeCompare(b.title);
  });
}
