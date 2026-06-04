import type { Metadata } from "next";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { getAllRailOverrides } from "@/lib/data/discoverOverrides";
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
  getFeaturedEvents,
  filterBrowseCategories,
} from "@/lib/discover/discoverEngine";

export const metadata: Metadata = {
  title: { absolute: "Happy Hour Compass" },
};

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Rail selection is handled entirely by the Discover Engine.
// This page fetches venue data and rail overrides once, then delegates all
// filtering/sorting/curation to engine functions.
// To change rail behaviour, update discoverEngine.ts.
// To manage internal curation, use /control-panel/discover.
// ─────────────────────────────────────────────────────────────────────────────

export default async function ConsumerHomePage() {
  const [venues, allOverrides] = await Promise.all([
    getPublishedVenuesForConsumer(),
    getAllRailOverrides(),
  ]);

  // ── Homepage rails ────────────────────────────────────────────────────────
  const spotlightVenues    = getSpotlightVenues(venues, allOverrides["spotlight"]).slice(0, RAIL_MAX);
  const patioPicksVenues   = getPatioPicks(venues, allOverrides["patio-picks"]).slice(0, RAIL_MAX);
  const highlyRatedVenues  = getHighlyRated(venues, allOverrides["highly-rated"]).slice(0, RAIL_MAX);
  const nearbyVenues       = getFeaturedNearby(venues, allOverrides["featured-nearby"]).slice(0, NEARBY_POOL);
  const newThisWeekVenues  = getNewThisWeek(venues, allOverrides["new-this-week"]).slice(0, RAIL_MAX);
  const featuredEvents     = getFeaturedEvents(venues, allOverrides["featured-events"]).slice(0, RAIL_MAX);

  // ── Browse sections — filter to categories with ≥ BROWSE_MIN_LOCAL venues ─
  const browseExperienceCategories = filterBrowseCategories(venues, EXPERIENCE_CATEGORIES);
  const browseFoodCategories       = filterBrowseCategories(venues, FOOD_CATEGORIES);
  const browseDrinksCategories     = filterBrowseCategories(venues, DRINKS_CATEGORIES);

  return (
    <main className="bg-gray-50">
      <WelcomeGate>
        <ConsumerHome
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
