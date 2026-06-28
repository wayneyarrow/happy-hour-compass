/**
 * Happy Hour status computation — pure utility, server + client safe.
 *
 * The canonical HH schedule lives in ConsumerVenue.happyHourWeekly:
 *   Record<string, Array<{ start: string; end: string }>>
 * where start/end are "HH:MM" 24-hour strings, or "close" (treated as midnight).
 *
 * Mirrors the core logic of calculateHappyHourStatus() in
 * app/(consumer)/venue/[id]/HappyHourTimesCard.tsx, adapted to return the
 * structured HhStatus type consumed by website card components rather than
 * the plain { text, isActive } pair used by the consumer detail view.
 *
 * Empty-state rule: returns { type: "none" } when no HH windows exist this week.
 * Card components should hide the status row entirely in this case.
 */

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type HHSlot = { start: string; end: string };

/**
 * HH card status — drives the green "On Now" and amber "Upcoming" badges.
 * Intentionally minimal for card use; the Venue Detail page should render
 * the full weekly schedule using HappyHourTimesCard instead.
 */
export type HhStatus =
  | { type: "active"; endsIn: string }
  | { type: "upcoming"; day: string; startsAt: string }
  | { type: "none" };

function timeToMinutes(t: string): number {
  if (t === "close") return 1440; // treat "close" as midnight (24:00)
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Formats "HH:MM" to a short display like "4 PM" or "4:30 PM". */
function formatDisplayTime(t: string): string {
  if (t === "close") return "midnight";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}${m > 0 ? ":" + String(m).padStart(2, "0") : ""} ${period}`;
}

/** Formats remaining minutes as "Ends in X hr Y min". */
function formatEndsIn(endMin: number, nowMin: number): string {
  const diff = Math.max(1, endMin - nowMin);
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h > 0 && m > 0) return `Ends in ${h} hr ${m} min`;
  if (h > 0) return `Ends in ${h} hr`;
  return `Ends in ${m} min`;
}

/**
 * Computes the HH card status from the weekly schedule.
 *
 * Uses the current wall-clock time at call time — accurate for server-rendered
 * pages that use force-dynamic (re-fetched on every request). Does not auto-update
 * client-side after initial render; a live countdown is a future enhancement.
 *
 * State resolution order:
 *   1. On now: a slot is active right now → { type: "active" }
 *   2. Today: a later slot exists today  → { type: "upcoming", day: "Today" }
 *   3. Next day: next day with any slot  → { type: "upcoming", day: "Tomorrow"|dayName }
 *   4. No HH this week                  → { type: "none" }
 */
export function computeHhStatus(
  happyHourWeekly: Record<string, HHSlot[]>
): HhStatus {
  const now = new Date();
  const currentDay = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayName = DAY_NAMES[currentDay];
  const todaySlots = happyHourWeekly[todayName] ?? [];

  // State 1: Active right now
  for (const slot of todaySlots) {
    const startMin = timeToMinutes(slot.start);
    const endMin = timeToMinutes(slot.end);
    if (nowMin >= startMin && nowMin < endMin) {
      return { type: "active", endsIn: formatEndsIn(endMin, nowMin) };
    }
  }

  // State 2: Upcoming later today
  const upcomingToday = todaySlots.filter(
    (s) => timeToMinutes(s.start) > nowMin
  );
  if (upcomingToday.length > 0) {
    return {
      type: "upcoming",
      day: "Today",
      startsAt: formatDisplayTime(upcomingToday[0].start),
    };
  }

  // State 3: Next day with HH (search forward up to 7 days)
  for (let i = 1; i <= 7; i++) {
    const nextName = DAY_NAMES[(currentDay + i) % 7];
    const nextSlots = happyHourWeekly[nextName] ?? [];
    if (nextSlots.length > 0) {
      return {
        type: "upcoming",
        day: i === 1 ? "Tomorrow" : nextName,
        startsAt: formatDisplayTime(nextSlots[0].start),
      };
    }
  }

  return { type: "none" };
}
