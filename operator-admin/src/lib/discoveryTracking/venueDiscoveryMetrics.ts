/**
 * Operator Admin "Discover Impressions" / "Discover Clicks" (Premium) —
 * definitions since migration 110.
 *
 *   Discover Impressions = website_discovery_events item_impression rows in
 *     PRODUCTION for this venue's cards: its venue cards plus its Daily
 *     Special cards (both open the venue page). Visible impressions only —
 *     ≥50% of the card on screen for ≥1s. The old load-based
 *     venue_discover_events impressions (website rows before migration 110,
 *     and the consumer app's) are never counted: they recorded that a rail
 *     loaded, not that the venue was seen. Counting starts when the new
 *     tracking deploys, so the 30-day figure builds up over its first month.
 *   Discover Clicks = clicks on those same cards: new item_click rows in
 *     production + venue_discover_events clicks that are legacy (environment
 *     NULL) or production. The website stopped writing venue_discover_events
 *     with migration 110, so the two sources never overlap.
 * Staging/preview/development rows are excluded from both.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgREST `.or()` filter selecting this venue's discovery items in
 * website_discovery_events. Non-UUID ids are dropped (they can't match and
 * must never be interpolated into a filter string).
 */
export function buildVenueDiscoveryItemFilter(venueId: string, dailySpecialIds: readonly string[]): string {
  const clauses: string[] = [];
  if (UUID_RE.test(venueId)) clauses.push(`and(item_type.eq.venue,item_id.eq.${venueId})`);
  const specials = dailySpecialIds.filter((id) => UUID_RE.test(id));
  if (specials.length > 0) clauses.push(`and(item_type.eq.daily_special,item_id.in.(${specials.join(",")}))`);
  // A filter that matches nothing when there is no valid id at all.
  return clauses.length > 0 ? clauses.join(",") : "and(item_type.eq.venue,item_id.is.null)";
}

/** venue_discover_events clicks that count toward the operator metric. */
export const LEGACY_DISCOVER_CLICK_ENVIRONMENT_FILTER = "environment.is.null,environment.eq.production";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Operator Admin note under "Discover Impressions". While on-screen counting
 * is younger than the 30-day window, says so with the start date so a low
 * number isn't read as a drop.
 */
export function discoverImpressionsNote(countingSince: string | null, now: Date = new Date()): string {
  const base = "Times your venue was actually on screen in homepage picks and guides";
  if (!countingSince) return `${base}. New on-screen counting starts soon.`;
  const start = new Date(countingSince);
  if (Number.isNaN(start.getTime()) || now.getTime() - start.getTime() >= 30 * DAY_MS) return base;
  const label = start.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Vancouver" });
  return `${base} — counted since ${label}, when we started measuring on-screen views, so this builds up to a full 30 days.`;
}
