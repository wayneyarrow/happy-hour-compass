/**
 * Today's Specials homepage section — data orchestration.
 *
 * Composes existing, unmodified data sources (no new query shape, no new
 * analytics table):
 *   - getPublishedDailySpecialsForWebsite() — the SAME published/eligible-
 *     venue/market-scoped Daily Specials query the search results page and
 *     homepage Hero search already use.
 *   - getVenueViewCounts() (viewCounts.ts) — the SAME "Last 30 Days" venue
 *     view aggregation already used by CPanel Analytics/Action
 *     Center/Venue Detail — no Special-specific analytics were built.
 *   - getMarketLocalIsoDate() (marketLocalDate.ts) — market-local "today",
 *     never raw server/UTC time.
 * ...then hands the result to the pure selectTodaysSpecials() ranking layer
 * (todaysSpecialsRanking.ts). This function's only job is fetching +
 * wiring; all selection/ranking logic lives in that pure module.
 */

import { getPublishedDailySpecialsForWebsite } from "./dailySpecials";
import { getVenueViewCounts } from "./viewCounts";
import { getMarketLocalIsoDate } from "@/lib/marketLocalDate";
import {
  selectTodaysSpecials,
  TODAYS_SPECIALS_DEFAULT_LIMIT,
  type TodaysSpecialOverride,
} from "@/lib/todaysSpecialsRanking";
import type { WebsiteDailySpecialListItem } from "./dailySpecials";
import type { Market } from "@/lib/markets";

const POPULARITY_WINDOW_DAYS = 30;

/**
 * Resolves the homepage's Today's Specials selection for `market`.
 *
 * `now` is an explicit argument (defaults to `new Date()` only at this one
 * call boundary, not threaded implicitly through the pure ranking layer)
 * so a Server Component gets today's real selection with zero ceremony,
 * while tests can inject a fixed instant.
 *
 * `overrides` is always `[]` today — no `daily_special_overrides` table
 * exists yet (see todaysSpecialsRanking.ts's module header and this
 * feature's CPanel-integration report). Threading it as a parameter here
 * means a future caller can pass real founder overrides in without any
 * change to this function's body.
 */
export async function getTodaysSpecialsForHomepage(
  market: Market,
  options?: { now?: Date; limit?: number; overrides?: TodaysSpecialOverride[] }
): Promise<WebsiteDailySpecialListItem[]> {
  const now = options?.now ?? new Date();
  const todayIso = getMarketLocalIsoDate(market.id, now);

  const specials = await getPublishedDailySpecialsForWebsite(market);
  if (specials.length === 0) return [];

  const venueIds = [...new Set(specials.map((s) => s.venueId))];
  const since = new Date(now.getTime() - POPULARITY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const viewCounts = await getVenueViewCounts(since, venueIds);

  return selectTodaysSpecials({
    candidates: specials.map((special) => ({ special, venueViews: viewCounts.get(special.venueId) })),
    todayIso,
    overrides: options?.overrides ?? [],
    limit: options?.limit ?? TODAYS_SPECIALS_DEFAULT_LIMIT,
  });
}
