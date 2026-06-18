import type { Metadata } from "next";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { getCPFeaturedEventCandidates } from "@/lib/data/events";
import { getAllRailOverrides } from "@/lib/data/discoverOverrides";
import { getEventOverridesForRail } from "@/lib/data/discoverEventOverrides";
import { getActiveMarket } from "@/lib/activeMarket";
import { toMarketConfig } from "@/lib/markets";
import { WelcomeGate } from "./WelcomeGate";
import { ConsumerHome } from "./home/ConsumerHome";
import {
  EXPERIENCE_CATEGORIES,
  FOOD_CATEGORIES,
  DRINKS_CATEGORIES,
} from "./home/browseCategories";
import {
  RAIL_MAX,
  NEARBY_POOL,
  getSpotlightVenues,
  getPatioPicks,
  getHighlyRated,
  getFeaturedNearby,
  getNewThisWeek,
  filterBrowseCategories,
  type DiscoverEventItem,
} from "@/lib/discover/discoverEngine";
import { computeFeaturedEventRail } from "@/lib/discover/featuredEventsEngine";

export const metadata: Metadata = {
  title: { absolute: "Happy Hour Compass" },
};

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Rail selection is handled by the Discover Engine and Featured Events Engine.
// This page fetches data once, then delegates all filtering/sorting/curation
// to engine functions.
// To change venue rail behaviour, update discoverEngine.ts.
// To change Featured Events behaviour, update featuredEventsEngine.ts.
// To manage internal curation, use /control-panel/discover.
// ─────────────────────────────────────────────────────────────────────────────

export default async function ConsumerHomePage() {
  const [
    { market, isPersisted },
    venues,
    allOverrides,
    eventCandidates,
    eventOverrides,
  ] = await Promise.all([
    getActiveMarket(),
    getPublishedVenuesForConsumer(),
    getAllRailOverrides(),
    getCPFeaturedEventCandidates(),
    getEventOverridesForRail("featured-events"),
  ]);

  const marketConfig = toMarketConfig(market);

  // ── Venue rails ───────────────────────────────────────────────────────────
  const spotlightVenues   = getSpotlightVenues(venues, allOverrides["spotlight"],       marketConfig).slice(0, RAIL_MAX);
  const patioPicksVenues  = getPatioPicks(venues,      allOverrides["patio-picks"],      marketConfig).slice(0, RAIL_MAX);
  const highlyRatedVenues = getHighlyRated(venues,     allOverrides["highly-rated"],     marketConfig).slice(0, RAIL_MAX);
  const nearbyVenues      = getFeaturedNearby(venues,  allOverrides["featured-nearby"],  marketConfig).slice(0, NEARBY_POOL);
  const newThisWeekVenues = getNewThisWeek(venues,     allOverrides["new-this-week"],    marketConfig).slice(0, RAIL_MAX);

  // ── Featured Events rail — event-level engine ─────────────────────────────
  const featuredEvents: DiscoverEventItem[] = computeFeaturedEventRail(
    eventCandidates,
    eventOverrides,
    allOverrides["featured-events"],
    marketConfig
  )
    .slice(0, RAIL_MAX)
    .map((e) => ({
      id:                  e.eventUuid,
      title:               e.title,
      venueName:           e.venueName,
      venueSlug:           e.venueSlug,
      nextOccurrenceLabel: e.nextOccurrenceLabel,
    }));

  // ── Browse sections — filter to categories with ≥ BROWSE_MIN_LOCAL venues ─
  const browseExperienceCategories = filterBrowseCategories(venues, EXPERIENCE_CATEGORIES, undefined, marketConfig);
  const browseFoodCategories       = filterBrowseCategories(venues, FOOD_CATEGORIES,       undefined, marketConfig);
  const browseDrinksCategories     = filterBrowseCategories(venues, DRINKS_CATEGORIES,     undefined, marketConfig);

  return (
    <main className="bg-gray-50">
      <WelcomeGate>
        <ConsumerHome
          market={market}
          isPersisted={isPersisted}
          spotlightVenues={spotlightVenues}
          patioPicksVenues={patioPicksVenues}
          highlyRatedVenues={highlyRatedVenues}
          nearbyVenues={nearbyVenues}
          newThisWeekVenues={newThisWeekVenues}
          featuredEvents={featuredEvents}
          browseExperienceCategories={browseExperienceCategories}
          browseFoodCategories={browseFoodCategories}
          browseDrinksCategories={browseDrinksCategories}
        />
      </WelcomeGate>
    </main>
  );
}
