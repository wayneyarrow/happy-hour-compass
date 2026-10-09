/**
 * Founder-entered grant dates → exact instants. Pure, client-safe.
 *
 * The Control Panel shows every date in CONTROL_PANEL_TIME_ZONE
 * (America/Vancouver — see src/lib/controlPanelDateTime.ts), so grant dates
 * are entered and interpreted in that same zone:
 *   - Start date D   → access begins at 00:00 on D.
 *   - "Access through D" → access ends at 00:00 on D + 1 (ends_at is
 *     exclusive), so the venue keeps access for the whole of day D.
 */

import { CONTROL_PANEL_TIME_ZONE } from "@/lib/controlPanelDateTime";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - instantMs;
}

/** 00:00 on `isoDate` (YYYY-MM-DD) in `timeZone`, as an ISO instant. Null if invalid. */
export function zonedMidnightIso(isoDate: string, timeZone: string = CONTROL_PANEL_TIME_ZONE): string | null {
  const m = DATE_RE.exec(isoDate.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const naiveUtc = Date.UTC(y, mo - 1, d);
  const check = new Date(naiveUtc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  // Two passes handle a DST transition between the naive guess and the result.
  let instant = naiveUtc - zoneOffsetMs(naiveUtc, timeZone);
  instant = naiveUtc - zoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

/** Exclusive end instant for "access through `isoDate`". */
export function accessThroughEndIso(isoDate: string, timeZone: string = CONTROL_PANEL_TIME_ZONE): string | null {
  const m = DATE_RE.exec(isoDate.trim());
  if (!m) return null;
  const next = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1));
  return zonedMidnightIso(next.toISOString().slice(0, 10), timeZone);
}

/** Inverse of accessThroughEndIso, for display: the last full day of access. */
export function lastAccessDateLabel(endsAtIso: string, timeZone: string = CONTROL_PANEL_TIME_ZONE): string {
  const lastMoment = new Date(Date.parse(endsAtIso) - 1);
  // Same "Oct 9, 2026" shape as formatDate() in controlPanelDateTime.ts.
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(lastMoment);
}

/** Whole days from `nowMs` until `endsAtIso` (ceil); 0 once ended. */
export function daysUntil(endsAtIso: string, nowMs: number): number {
  const diff = Date.parse(endsAtIso) - nowMs;
  return diff <= 0 ? 0 : Math.ceil(diff / 86_400_000);
}
