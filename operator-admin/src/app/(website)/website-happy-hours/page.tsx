import type { Metadata } from "next";
import { getActiveMarket } from "@/lib/activeMarket";
import SearchContextHeader from "./SearchContextHeader";
import { SearchResultCard } from "./SearchResultCard";
import type { SearchResultCardData } from "./SearchResultCard";

export const metadata: Metadata = {
  title: "Happy Hours — Happy Hour Compass",
  robots: { index: false },
};

const FILTER_CHIPS = ["Near Me", "On Now", "Time", "Top Rated", "Type", "Sort"];

// ─── Sample cards — hard-coded for visual design validation ──────────────────
// Replace with real venue data when wiring the Discover Engine.

const SAMPLE_CARDS: SearchResultCardData[] = [
  {
    id: "king-taps",
    name: "King Taps",
    image: "/images/casual-dining-1.jpg",
    isVerified: true,
    googleRating: 4.6,
    hhStatus: { type: "active", endsIn: "Ends in 1 hr 12 min" },
    distanceKm: 0.8,
    establishmentType: "Restaurant",
    foodSpecial: "🍔 Half-price Burgers",
    drinkSpecial: "🍺 $6 Local Pints",
  },
  {
    id: "bna-brewing",
    name: "BNA Brewing & Eatery",
    image: "/images/sports-bar-1.jpg",
    isVerified: false,
    googleRating: 4.3,
    hhStatus: { type: "upcoming", day: "Today", startsAt: "3:30 PM" },
    distanceKm: 2.3,
    establishmentType: "Brewery",
    drinkSpecial: "🍺 $7 Craft Pints",
  },
  {
    id: "blarney-stone",
    name: "The Blarney Stone",
    image: "/images/sports-bar-1.jpg",
    isVerified: true,
    googleRating: 4.1,
    hhStatus: { type: "upcoming", day: "Tomorrow", startsAt: "4:00 PM" },
    distanceKm: 4.1,
    establishmentType: "Pub",
    foodSpecial: "🍟 $9 Pub Appetizers",
    drinkSpecial: "🥃 $8 Whiskey Cocktails",
  },
  {
    id: "earls-kitchen",
    name: "Earls Kitchen + Bar",
    image: "/images/fine-dining-1.jpg",
    isVerified: true,
    googleRating: 4.5,
    hhStatus: { type: "active", endsIn: "Ends in 45 min" },
    distanceKm: 1.2,
    establishmentType: "Restaurant",
    foodSpecial: "🥙 50% Off Shareables",
    drinkSpecial: "🍷 $10 House Wine",
  },
  {
    id: "craft-beer-market",
    name: "Craft Beer Market",
    image: "/images/casual-dining-2.jpg",
    isVerified: false,
    googleRating: 4.8,
    hhStatus: { type: "upcoming", day: "Monday", startsAt: "3:00 PM" },
    distanceKm: 5.1,
    establishmentType: "Bar",
    foodSpecial: "🌮 $12 Loaded Nachos",
    drinkSpecial: "🍺 $5 Rotating Taps",
  },
];

// ─────────────────────────────────────────────────────────────────────────────

export default async function HappyHoursSearchPage() {
  const { market } = await getActiveMarket();

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
          <SearchContextHeader market={market} className="mb-7" />

          <div className="grid grid-cols-2 gap-4">
            {SAMPLE_CARDS.map((card) => (
              <SearchResultCard key={card.id} data={card} />
            ))}
          </div>
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
        <div className="px-4 pb-8 space-y-4">
          {SAMPLE_CARDS.map((card) => (
            <SearchResultCard key={card.id} data={card} />
          ))}
        </div>
      </div>
    </>
  );
}
