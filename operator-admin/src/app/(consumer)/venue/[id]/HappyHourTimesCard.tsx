"use client";

import { useState, useEffect } from "react";

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

// ─── status helpers ───────────────────────────────────────────────────────────

function timeToMinutes(timeStr: string): number {
  if (timeStr === "close") return 1440;
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Converts "HH:MM" or "close" to a short display like "4 PM" or "4:30 PM". */
function formatTime(timeStr: string): string {
  if (timeStr === "close") return "close";
  const [hours, minutes] = timeStr.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHour}${minutes > 0 ? ":" + minutes.toString().padStart(2, "0") : ""} ${period}`;
}

/** Formats a single HH slot as "4 PM–6 PM" (EN dash, no spaces). */
function formatSlot(slot: HHSlot): string {
  const startParts = slot.start.split(":").map(Number);
  const sh = startParts[0];
  const sm = startParts[1];
  const sPeriod = sh >= 12 ? "PM" : "AM";
  const sDH = sh === 0 ? 12 : sh > 12 ? sh - 12 : sh;
  const startDisplay = `${sDH}${sm > 0 ? ":" + sm.toString().padStart(2, "0") : ""} ${sPeriod}`;
  return `${startDisplay}\u2013${formatTime(slot.end)}`;
}

type HHStatus = {
  text: string;
  isActive: boolean;
};

/**
 * Mirrors calculateHappyHourStatus() from the original index.html.
 * Returns a status text and active flag based on current time.
 */
function calculateHappyHourStatus(
  happyHourWeekly: Record<string, HHSlot[]>
): HHStatus {
  const now = new Date();
  const currentDay = now.getDay();
  const currentTime = now.getHours() * 60 + now.getMinutes();
  const todayName = DAY_NAMES[currentDay];
  const todayWindows = happyHourWeekly[todayName] ?? [];

  // State 1: HH active in one of today's windows
  for (const w of todayWindows) {
    const startMin = timeToMinutes(w.start);
    const endMin = w.end === "close" ? 1440 : timeToMinutes(w.end);
    if (currentTime >= startMin && currentTime < endMin) {
      return { text: `On now · until ${formatTime(w.end)}`, isActive: true };
    }
  }

  // State 2: There is a later window today
  const upcoming = todayWindows.filter((w) => timeToMinutes(w.start) > currentTime);
  if (upcoming.length > 0) {
    return { text: `Starts at ${formatTime(upcoming[0].start)}`, isActive: false };
  }

  // State 3: All of today's windows have passed
  if (todayWindows.length > 0) {
    const last = todayWindows[todayWindows.length - 1];
    return { text: `Ended at ${formatTime(last.end)}`, isActive: false };
  }

  // State 4: No HH today — find next day with HH
  for (let i = 1; i <= 7; i++) {
    const nextName = DAY_NAMES[(currentDay + i) % 7];
    if ((happyHourWeekly[nextName] ?? []).length > 0) {
      const dayLabel = i === 1 ? "Tomorrow" : nextName;
      return {
        text: `No happy hour today · Next: ${dayLabel}`,
        isActive: false,
      };
    }
  }

  return { text: "No happy hour this week", isActive: false };
}

// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  happyHourWeekly: Record<string, HHSlot[]>;
  specialsFood: string[];
  specialsDrinks: string[];
};

/**
 * Blue info card for the Happy Hour section — mirrors the original
 * renderHappyHourSection() output from index.html.
 *
 * Layout:
 *   .info-box (bg #dbeafe)
 *     "Happy Hour Times"            ← .hh-section-heading
 *     "Today: {status}"  | "▾ Show full schedule"   ← .hh-header-row
 *     [expandable weekly schedule]  ← .hours-weekly
 *
 *   "Happy Hour Specials"           ← .hh-section-heading (outside box)
 *   Food / Drinks lists
 */
export function HappyHourTimesCard({ happyHourWeekly, specialsFood, specialsDrinks }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<HHStatus | null>(null);

  // True when at least one day has parsed time slots.
  const hasAnySlotsInWeekly = Object.values(happyHourWeekly).some(
    (slots) => slots.length > 0
  );

  // Calculate client-side so it uses browser's local time.
  useEffect(() => {
    setStatus(calculateHappyHourStatus(happyHourWeekly));
  }, [happyHourWeekly]);

  const hasSpecials = specialsFood.length > 0 || specialsDrinks.length > 0;

  // Nothing to render — show a minimal fallback rather than an empty blue box.
  if (!hasAnySlotsInWeekly && !hasSpecials) {
    return (
      <div
        className="rounded-[8px] p-4 mb-5 text-[14px] text-[#374151] leading-[1.5]"
        style={{ background: "#dbeafe" }}
      >
        Happy hour information not available.
      </div>
    );
  }

  return (
    <>
      {/* Blue info card — mirrors original .info-box */}
      <div
        className="rounded-[8px] p-4 mb-5 text-[14px] text-[#111827] leading-[1.5]"
        style={{ background: "#dbeafe" }}
      >
        {/* "Happy Hour Times" heading + today status + schedule toggle —
            only rendered when there are actual parsed time slots. */}
        {hasAnySlotsInWeekly && (
          <div className="text-[14px] font-bold text-[#111827] mb-3">
            Happy Hour Times
          </div>
        )}

        {/* Today status row + Show full schedule toggle — .hh-header-row */}
        {hasAnySlotsInWeekly && status && (
          <div className="flex items-baseline justify-between gap-3 mb-1">
            {/* .hh-status-left: flex, baseline, gap 6px */}
            <div className="flex-1 flex items-baseline gap-1.5 flex-wrap">
              {/* .hh-today-label: 15px medium #111827 */}
              <span className="text-[15px] font-medium text-[#111827]">Today:</span>
              {/* .hours-status-text inside info-box: 14px medium #374151 */}
              <span className="text-[14px] font-medium text-[#374151]">{status.text}</span>
            </div>
            {/* .hh-schedule-link inside info-box: 13px blue-800 */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-[13px] font-medium whitespace-nowrap flex-shrink-0 hover:underline"
              style={{ color: "#1e40af" }}
            >
              <span
                className={`text-[10px] transition-transform duration-200 inline-block ${
                  expanded ? "rotate-180" : ""
                }`}
              >
                ▾
              </span>
              <span>{expanded ? "Hide full schedule" : "Show full schedule"}</span>
            </button>
          </div>
        )}

        {/* Expandable weekly schedule — .hours-weekly */}
        {expanded && (
          <div className="mt-3 flex flex-col gap-2">
            {DAY_NAMES.map((day) => {
              const slots = happyHourWeekly[day] ?? [];
              const timeDisplay =
                slots.length === 0
                  ? "No happy hour"
                  : slots.map(formatSlot).join(", ");
              return (
                <div key={day} className="flex justify-between text-[14px]">
                  {/* .hours-day-name: 600 weight #374151 */}
                  <span className="font-semibold text-[#374151]">{day}</span>
                  {/* .hours-day-time inside info-box: #374151 */}
                  <span className="text-[#374151]">{timeDisplay}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Happy Hour Specials — inside the blue card, same background as Times section */}
        {hasSpecials && (
          <div className="text-[14px] text-[#111827]">
            {/* .hh-section-heading: 14px bold #111827, margin-top 20px */}
            <div className="text-[14px] font-bold text-[#111827] mt-5 mb-3">
              Happy Hour Specials
            </div>

            {specialsFood.length > 0 && (
              <div>
                {/* "Food" sub-heading: 13px semibold #374151, mt-3 */}
                <div className="mt-3 text-[13px] font-semibold text-[#374151]">Food</div>
                {specialsFood.map((item, i) => (
                  <div key={i} className="mt-1 text-[14px] text-[#111827]">
                    &bull; {item}
                  </div>
                ))}
              </div>
            )}

            {specialsDrinks.length > 0 && (
              <div>
                <div className="mt-3 text-[13px] font-semibold text-[#374151]">Drinks</div>
                {specialsDrinks.map((item, i) => (
                  <div key={i} className="mt-1 text-[14px] text-[#111827]">
                    &bull; {item}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
