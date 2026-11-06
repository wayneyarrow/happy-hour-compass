/**
 * Your Happy Hour Plans Giveaway (November 2026) — schedule for the
 * /weekly-picks signup-page callout.
 *
 * The callout shows from 11:00 a.m. Pacific on November 12, 2026 through
 * 11:59 p.m. Pacific on November 30, 2026, and is hidden from midnight
 * Pacific on December 1. Window boundaries are written as America/Vancouver
 * wall-clock times and converted to instants here, so the rule reads the
 * same as the official rules rather than as hand-computed UTC offsets.
 *
 * This schedule controls ONLY the callout. The rules page
 * (/weekly-picks/giveaway-rules) never reads it and stays available after
 * the contest closes, through the draw and winner confirmation.
 */

export const GIVEAWAY_TIME_ZONE = "America/Vancouver";

export const GIVEAWAY_RULES_PATH = "/weekly-picks/giveaway-rules";

/** Offset (ms) of `timeZone` from UTC at `instantMs`. */
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

/** A wall-clock time in `timeZone`, as an instant (ms since epoch). */
export function zonedWallTimeMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes handle a DST transition between the naive guess and the result.
  let instant = naiveUtc - zoneOffsetMs(naiveUtc, timeZone);
  instant = naiveUtc - zoneOffsetMs(instant, timeZone);
  return instant;
}

/** Callout first shows at this instant (inclusive): Nov 12, 2026, 11:00 a.m. Pacific. */
export const GIVEAWAY_CALLOUT_START_MS = zonedWallTimeMs(2026, 11, 12, 11, 0, GIVEAWAY_TIME_ZONE);

/** Callout is hidden from this instant (exclusive end): Dec 1, 2026, 12:00 a.m. Pacific. */
export const GIVEAWAY_CALLOUT_END_MS = zonedWallTimeMs(2026, 12, 1, 0, 0, GIVEAWAY_TIME_ZONE);

export function isGiveawayCalloutVisible(nowMs: number): boolean {
  return nowMs >= GIVEAWAY_CALLOUT_START_MS && nowMs < GIVEAWAY_CALLOUT_END_MS;
}

/**
 * The instant the /weekly-picks page uses to decide visibility.
 *
 * `next dev` only: GIVEAWAY_CALLOUT_NOW (an ISO instant) overrides the
 * clock so the before/during/after states can be checked locally. Ignored in
 * every built deployment (NODE_ENV is "production" for `next build`/`start`
 * and on Vercel), so no visitor or env misconfiguration can force the
 * callout on or off.
 */
export function giveawayCalloutNowMs(): number {
  if (process.env.NODE_ENV === "development") {
    const override = Date.parse(process.env.GIVEAWAY_CALLOUT_NOW ?? "");
    if (Number.isFinite(override)) return override;
  }
  return Date.now();
}
