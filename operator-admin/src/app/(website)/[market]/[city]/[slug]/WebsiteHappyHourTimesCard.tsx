"use client";

import { useState, useEffect } from "react";
import { getSessionId } from "@/lib/trackingSession";
import {
  computeHhTodayText,
  formatHhDay,
  hasAnyHappyHour,
  type HhSchedule,
} from "@/lib/happyHourStatus";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type Props = {
  venueId: string;
  schedule: HhSchedule;
  /** Initial state of the weekly-schedule toggle (deep links); collapsed by default. */
  initialExpanded?: boolean;
};

/**
 * Website copy of the consumer HappyHourTimesCard's times box (same markup),
 * driven by the shared venue-local schedule engine (src/lib/happyHourStatus.ts)
 * so its "Today:" line agrees with the venue page pills, cards and On Now.
 * The consumer component is left untouched (repo rule: import, don't modify).
 * Specials render in their own subsection on the venue page, so this card
 * only shows times.
 */
export function WebsiteHappyHourTimesCard({ venueId, schedule, initialExpanded = false }: Props) {
  const hasAnySlotsInWeekly = hasAnyHappyHour(schedule);

  const [expanded, setExpanded] = useState(initialExpanded && hasAnySlotsInWeekly);
  const [status, setStatus] = useState<{ text: string; isActive: boolean } | null>(null);

  // Client-side after mount (no hydration mismatch); venue-local regardless
  // of the visitor's timezone.
  useEffect(() => {
    setStatus(computeHhTodayText(schedule));
  }, [schedule]);

  if (!hasAnySlotsInWeekly) {
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
    <div
      className="rounded-2xl p-4 mb-5 text-[14px] text-[#111827] leading-[1.5]"
      style={{
        background: "linear-gradient(160deg, #fef3c7 0%, #fffbf5 100%)",
        border: "1px solid #fde68a",
        boxShadow: "0 2px 8px rgba(180,83,9,0.06)",
      }}
    >
      <div className="flex items-center gap-2 text-[14px] font-bold text-amber-800 mb-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        Happy Hour Times
      </div>

      {status && (
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex-1 flex items-baseline gap-1.5 flex-wrap">
            <span className="text-[15px] font-medium text-[#111827]">Today:</span>
            <span className="text-[14px] font-medium text-[#374151]">{status.text}</span>
          </div>
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

      {expanded && (
        <div className="mt-3 flex flex-col gap-2">
          {DAY_NAMES.map((day) => (
            <div key={day} className="flex justify-between text-[14px]">
              <span className="font-semibold text-[#374151]">{day}</span>
              <span className="text-[#374151]">{formatHhDay(schedule, day)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
