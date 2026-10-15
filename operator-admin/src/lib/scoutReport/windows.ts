/**
 * Scout report windows — pure, no I/O.
 *
 * Every window is a half-open interval [startUtc, endUtc) whose bounds are
 * 00:00 America/Vancouver on a Monday. The default report covers the
 * previous complete Monday–Sunday week; the comparison is the week before
 * it. Built on the Search & Discovery report's own Vancouver-midnight helper
 * (vancouverMidnight), which already corrects for daylight-saving changes,
 * so a week containing a DST transition is 167 or 169 hours long.
 */

import { REPORT_TIME_ZONE, vancouverDateKey, vancouverMidnight } from "@/lib/searchDiscoveryReporting/config";

export type ReportWindowKey = "current" | "comparison";

export type ReportWindow = {
  key: ReportWindowKey;
  /** Inclusive lower bound (UTC). */
  startUtc: string;
  /** Exclusive upper bound (UTC). */
  endUtc: string;
  timeZone: typeof REPORT_TIME_ZONE;
  /** Vancouver calendar date of the first day (a Monday). */
  startDate: string;
  /** Vancouver calendar date of the last day (a Sunday). */
  endDateInclusive: string;
  label: string;
  hours: number;
};

/** 0 = Monday … 6 = Sunday, for `now`'s Vancouver calendar date. */
export function vancouverWeekdayIndex(now: Date): number {
  const [y, m, d] = vancouverDateKey(now).split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

const labelFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function makeWindow(key: ReportWindowKey, start: Date, end: Date): ReportWindow {
  const lastInstant = new Date(end.getTime() - 1);
  return {
    key,
    startUtc: start.toISOString(),
    endUtc: end.toISOString(),
    timeZone: REPORT_TIME_ZONE,
    startDate: vancouverDateKey(start),
    endDateInclusive: vancouverDateKey(lastInstant),
    label: `${labelFormat.format(start)} – ${labelFormat.format(lastInstant)} (${REPORT_TIME_ZONE})`,
    hours: Math.round((end.getTime() - start.getTime()) / 3_600_000),
  };
}

/** The previous complete Monday–Sunday Vancouver week, and the week before it. */
export function computeReportWindows(now: Date): { current: ReportWindow; comparison: ReportWindow } {
  const sinceMonday = vancouverWeekdayIndex(now);
  const thisMonday = vancouverMidnight(now, sinceMonday);
  const lastMonday = vancouverMidnight(now, sinceMonday + 7);
  const mondayBefore = vancouverMidnight(now, sinceMonday + 14);
  return {
    current: makeWindow("current", lastMonday, thisMonday),
    comparison: makeWindow("comparison", mondayBefore, lastMonday),
  };
}

/** Half-open membership: start <= ts < end. */
export function isInWindow(ts: string, w: Pick<ReportWindow, "startUtc" | "endUtc">): boolean {
  const t = Date.parse(ts);
  return t >= Date.parse(w.startUtc) && t < Date.parse(w.endUtc);
}

// ── Coverage ────────────────────────────────────────────────────────────────

export type Coverage = {
  status: "full" | "partial" | "unavailable";
  /** Earliest recorded row for this metric (any window), or null if none. */
  firstRecordedAt: string | null;
  note: string | null;
};

/**
 * Whether a metric's recorded history covers a window. "unavailable" means
 * there is no data for the window at all — its values must be null, never 0.
 */
export function coverageFor(w: Pick<ReportWindow, "startUtc" | "endUtc">, firstRecordedAt: string | null): Coverage {
  if (!firstRecordedAt) {
    return { status: "unavailable", firstRecordedAt: null, note: "No rows have been recorded for this metric yet." };
  }
  const t = Date.parse(firstRecordedAt);
  if (t >= Date.parse(w.endUtc)) {
    return { status: "unavailable", firstRecordedAt, note: `The first recorded row (${firstRecordedAt}) is after this window — no data exists for it.` };
  }
  if (t > Date.parse(w.startUtc)) {
    return { status: "partial", firstRecordedAt, note: `The first recorded row (${firstRecordedAt}) is inside this window — it covers only part of the week.` };
  }
  return { status: "full", firstRecordedAt, note: null };
}
