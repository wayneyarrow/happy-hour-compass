/**
 * Small "NEW" feature badges (e.g. the homepage Hero's Daily Specials
 * selector pill) that should self-expire without any DB state, cron,
 * per-user/localStorage first-seen tracking, or manual UI cleanup.
 *
 * Usage: pick an expiry constant for the feature, compute visibility with
 * `isFeatureNewBadgeVisible(now, untilIso)`, and stop rendering the badge
 * once it returns false — the label/control it decorates stays exactly as
 * it was, only the pill disappears.
 *
 * `now` is always an explicit argument (never defaulted to `new Date()`
 * inside this function) so callers control the comparison directly. In
 * particular, a Server Component should compute the boolean once (e.g.
 * `isFeatureNewBadgeVisible(new Date(), DAILY_SPECIALS_NEW_UNTIL)`) and pass
 * it down as a plain boolean prop to any Client Component that renders the
 * badge, rather than having the Client Component call `new Date()` itself
 * during render — the latter can genuinely disagree between the server's
 * render pass and the browser's hydration pass right at the expiry
 * boundary (however briefly), which is exactly the hydration mismatch this
 * shape avoids.
 */

/**
 * Daily Specials homepage Hero launch — NEW badge on the selector's Daily
 * Specials option. ~30 days from this feature's 2026-09-09 launch period.
 * Bump (or add a sibling constant) when the next feature wants this same
 * treatment.
 */
export const DAILY_SPECIALS_NEW_UNTIL = "2026-10-09";

/**
 * True while `now` is strictly before `untilIso` (an inclusive
 * "YYYY-MM-DD" calendar date, evaluated at that date's UTC midnight).
 * Deterministic and pure — no clock or storage reads of its own.
 */
export function isFeatureNewBadgeVisible(now: Date, untilIso: string): boolean {
  const untilMs = Date.parse(`${untilIso}T00:00:00.000Z`);
  if (Number.isNaN(untilMs)) return false;
  return now.getTime() < untilMs;
}
