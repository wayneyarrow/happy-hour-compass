import type { Metadata } from "next";
import { getActiveMarket } from "@/lib/activeMarket";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { isNearMarket } from "@/lib/discover/discoverEngine";
import { toMarketConfig } from "@/lib/markets";
import { computeHhStatus } from "@/lib/happyHourStatus";
import SearchContextHeader from "./SearchContextHeader";
import { SearchResultCard } from "./SearchResultCard";
import type { SearchResultCardData } from "./SearchResultCard";

export const metadata: Metadata = {
  title: "Happy Hours — Happy Hour Compass",
  robots: { index: false },
};

// force-dynamic ensures the market cookie and venue data are always fresh.
export const dynamic = "force-dynamic";

const FILTER_CHIPS = ["Near Me", "On Now", "Time", "Top Rated", "Type", "Sort"];

/**
 * Maps an establishment type string to a local fallback image path.
 * Mirrors getVenueImageSrc() from app/(consumer)/VenueList.tsx.
 * Used only when a venue has no uploaded images.
 */
function fallbackImage(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar")) return "/images/sports-bar-1.jpg";
  if (t.includes("brewery") || t.includes("pub")) return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function HappyHoursSearchPage() {
  const { market } = await getActiveMarket();
  const marketConfig = toMarketConfig(market);

  // Fetch all published venues then gate to the active market.
  // isNearMarket() is the canonical geo filter used by the Discover Engine;
  // venues without coordinates are included permissively (assumed local).
  const allVenues = await getPublishedVenuesForConsumer();
  const venues = allVenues.filter((v) =>
    isNearMarket(v.latitude, v.longitude, marketConfig)
  );

  // Map ConsumerVenue → SearchResultCardData
  const cards: SearchResultCardData[] = venues.map((venue) => ({
    id: venue.id,                                    // slug — used for bookmark key
    href: `/venue/${venue.id}`,                      // future Venue Detail page route
    name: venue.name,
    image: venue.images[0]?.url ?? fallbackImage(venue.establishmentType),
    isVerified: venue.isVerified,
    googleRating: venue.googleRating,
    hhStatus: computeHhStatus(venue.happyHourWeekly),
    // Distance requires client-side geolocation; null until that layer is added.
    distanceKm: null,
    establishmentType: venue.establishmentType,
    foodSpecial: venue.specialsFood[0] ?? undefined,
    drinkSpecial: venue.specialsDrinks[0] ?? undefined,
  }));

  return (
    <>
      {/* Sticky filter chip bar */}
      <div className="sticky top-16 md:top-[72px] z-20 bg-white border-b border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-2 px-4 md:px-6 py-3 overflow-x-auto">
          {FILTER_CHIPS.map((label) => (
            <button
              key={label}
              type="button"
              className="
                flex-shrink-0 px-4 py-2
                bg-white border border-gray-200 rounded-full
                text-sm font-medium text-gray-800
                shadow-[0_1px_2px_rgba(0,0,0,0.04)]
                hover:border-gray-300 hover:bg-gray-50
                transition-all whitespace-nowrap
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400
              "
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop: 50/50 split layout */}
      <div className="hidden md:flex">
        {/* Results column — 50%, scrolls with the page */}
        <div className="w-1/2 min-h-[calc(100dvh-72px)] border-r border-gray-100 px-5 pt-8 pb-10">
          <SearchContextHeader
            market={market}
            resultCount={cards.length}
            className="mb-7"
          />

          {cards.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm font-semibold text-gray-500">No venues found</p>
              <p className="text-xs text-gray-400 mt-1">
                Try switching to a different market.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {cards.map((card) => (
                <SearchResultCard key={card.id} data={card} />
              ))}
            </div>
          )}
        </div>

        {/* Map column — 50%, sticky within viewport */}
        <div className="w-1/2">
          <div
            className="sticky top-[132px] flex p-4"
            style={{ height: "calc(100dvh - 132px)" }}
          >
            {/* Map panel — breathing room comes from parent padding */}
            <div className="flex-1 rounded-2xl bg-gray-100 flex items-center justify-center overflow-hidden">
              <div className="text-center px-8">
                <div className="w-16 h-16 rounded-2xl bg-white mx-auto flex items-center justify-center mb-4 shadow-sm">
                  <svg
                    className="w-8 h-8 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                    />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-600">
                  Interactive Map Placeholder
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Google Maps integration coming soon
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: stacked layout — filters → context → map → results */}
      <div className="md:hidden">
        <SearchContextHeader
          market={market}
          resultCount={cards.length}
          className="px-4 pt-6 pb-5 border-b border-gray-100"
        />

        {/* Map placeholder */}
        <div className="mx-4 my-4 h-52 rounded-2xl bg-gray-100 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-500">
              Interactive Map Placeholder
            </p>
            <p className="text-xs text-gray-400 mt-1">Coming soon</p>
          </div>
        </div>

        {/* Results */}
        {cards.length === 0 ? (
          <div className="px-4 pb-8 text-center py-16">
            <p className="text-sm font-semibold text-gray-500">No venues found</p>
            <p className="text-xs text-gray-400 mt-1">
              Try switching to a different market.
            </p>
          </div>
        ) : (
          <div className="px-4 pb-8 space-y-4">
            {cards.map((card) => (
              <SearchResultCard key={card.id} data={card} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
