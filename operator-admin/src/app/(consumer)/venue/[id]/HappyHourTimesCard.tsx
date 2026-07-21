"use client";

import { useState, useEffect } from "react";
import { getSessionId } from "@/lib/trackingSession";

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
  return `${startDisplay}–${formatTime(slot.end)}`;
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
  venueId: string;
  happyHourWeekly: Record<string, HHSlot[]>;
  specialsFood: string[];
  specialsDrinks: string[];
  /**
   * Controls the initial state of the weekly-schedule toggle below — e.g. for
   * a deep link that should land with the schedule already visible. Purely an
   * initial value: the toggle button still works normally afterward, and
   * omitting this prop preserves today's default (collapsed).
   */
  initialExpanded?: boolean;
};

/**
 * Warm amber info card for the Happy Hour section — mirrors the original
 * renderHappyHourSection() output from index.html.
 *
 * Layout:
 *   .info-box (bg warm amber)
 *     "Happy Hour Times"            ← .hh-section-heading
 *     "Today: {status}"  | "Full schedule ▾"   ← .hh-header-row
 *     [expandable weekly schedule]  ← .hours-weekly
 *
 *   "Happy Hour Specials"           ← .hh-section-heading (outside box)
 *   Food / Drinks lists
 */
export function HappyHourTimesCard({
  venueId,
  happyHourWeekly,
  specialsFood,
  specialsDrinks,
  initialExpanded = false,
}: Props) {
  // True when at least one day has parsed time slots.
  const hasAnySlotsInWeekly = Object.values(happyHourWeekly).some(
    (slots) => slots.length > 0
  );

  // Never start expanded into an empty schedule — initialExpanded only takes
  // effect when there's an actual weekly schedule to show.
  const [expanded, setExpanded] = useState(initialExpanded && hasAnySlotsInWeekly);
  const [status, setStatus] = useState<HHStatus | null>(null);

  // Calculate client-side so it uses browser's local time.
  useEffect(() => {
    setStatus(calculateHappyHourStatus(happyHourWeekly));
  }, [happyHourWeekly]);

  const hasSpecials = specialsFood.length > 0 || specialsDrinks.length > 0;

  // Nothing to render — show a minimal fallback rather than an empty card.
  if (!hasAnySlotsInWeekly && !hasSpecials) {
    return (
      <div
        className="rounded-2xl p-4 mb-5 text-[14px] text-[#374151] leading-[1.5]"
        style={{
          background: "linear-gradient(160deg, #fef3c7 0%, #fffbf5 100%)",
          border: "1px solid #fde68a",
          boxShadow: "0 2px 8px rgba(180,83,9,0.06)",
        }}
      >
        Happy hour information not available.
      </div>
    );
  }

  return (
    <>
      {/* Warm amber info card */}
      <div
        className="rounded-2xl p-4 mb-5 text-[14px] text-[#111827] leading-[1.5]"
        style={{
          background: "linear-gradient(160deg, #fef3c7 0%, #fffbf5 100%)",
          border: "1px solid #fde68a",
          boxShadow: "0 2px 8px rgba(180,83,9,0.06)",
        }}
      >
        {/* "Happy Hour Times" heading */}
        {hasAnySlotsInWeekly && (
          <div className="flex items-center gap-2 text-[14px] font-bold text-amber-800 mb-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Happy Hour Times
          </div>
        )}

        {/* Today status row + schedule toggle */}
        {hasAnySlotsInWeekly && status && (
          <div className="flex items-center justify-between gap-3 mb-2">
            {/* Today status */}
            <div className="flex-1 flex items-baseline gap-1.5 flex-wrap">
              <span className="text-[15px] font-medium text-[#111827]">Today:</span>
              <span className="text-[14px] font-medium text-[#374151]">{status.text}</span>
            </div>
            {/* Schedule toggle — improved spacing + SVG chevron */}
            <button
              type="button"
              onClick={() => {
                const opening = !expanded;
                setExpanded((v) => !v);
                if (opening) {
                  fetch("/api/track/venue-click", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      venueId,
                      clickType: "hh_schedule_expand",
                      sessionId: getSessionId(),
                    }),
                  }).catch(() => {});
                }
              }}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap flex-shrink-0 py-1 text-amber-800 hover:text-amber-900"
            >
              <span>{expanded ? "Hide full schedule" : "Show full schedule"}</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-200 ${expanded ? "-rotate-180" : ""}`}
                style={{ width: 14, height: 14, flexShrink: 0 }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
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
                  <span className="font-semibold text-[#374151]">{day}</span>
                  <span className="text-[#374151]">{timeDisplay}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Happy Hour Specials */}
        {hasSpecials && (
          <div className="text-[14px] text-[#111827]">
            {/* Divider between Times and Specials when both are shown */}
            {hasAnySlotsInWeekly && (
              <div style={{ height: 1, background: "rgba(180,83,9,0.15)", margin: "16px 0 16px" }} />
            )}
            <div className="flex items-center gap-2 text-[14px] font-bold text-amber-800 mb-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, flexShrink: 0 }}>
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              Happy Hour Specials
            </div>

            {specialsFood.length > 0 && (
              <div>
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
