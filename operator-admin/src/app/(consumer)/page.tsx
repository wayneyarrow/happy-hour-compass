import type { Metadata } from "next";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
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
// This page fetches venue data once, then delegates all filtering/sorting to
// engine functions.  To change rail behaviour, update discoverEngine.ts.
// ─────────────────────────────────────────────────────────────────────────────

export default async function ConsumerHomePage() {
  const venues = await getPublishedVenuesForConsumer();

  // ── Homepage rails ────────────────────────────────────────────────────────
  const spotlightVenues   = getSpotlightVenues(venues).slice(0, RAIL_MAX);
  const patioPicksVenues  = getPatioPicks(venues).slice(0, RAIL_MAX);
  const nearbyVenues      = getFeaturedNearby(venues).slice(0, NEARBY_POOL);
  const newThisWeekVenues = getNewThisWeek(venues).slice(0, RAIL_MAX);
  const featuredEvents    = getFeaturedEvents(venues).slice(0, RAIL_MAX);

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
