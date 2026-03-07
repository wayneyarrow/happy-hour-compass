import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { VenueList } from "./VenueList";

// Force a fresh Supabase query on every request — no static or router cache.
export const dynamic = "force-dynamic";

const FILTER_CHIPS = [
  "Happening Now",
  "Near Me",
  "Open Now",
  "Sports Bars",
  "Fine Dining",
  "Under $10",
];

export default async function ConsumerHomePage() {
  const venues = await getPublishedVenuesForConsumer();

  return (
    <main className="min-h-screen bg-gray-50">
      <style>{`
        @keyframes chip-scroll-hint {
          0%   { transform: translateX(0); }
          25%  { transform: translateX(-28px); }
          100% { transform: translateX(0); }
        }
        .chips-inner {
          animation: chip-scroll-hint 0.7s ease-in-out 0.8s both;
        }
        .chips-scroll::-webkit-scrollbar { display: none; }
        .chips-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* Search header */}
      <div className="bg-gray-50 border-b border-gray-100 px-4 pt-5 pb-4">
        <div className="max-w-2xl mx-auto">

          {/* Search input + List/Map toggle */}
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="search"
                placeholder="Search venues..."
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              />
            </div>

            {/* List / Map toggle */}
            <div className="flex rounded-xl border border-gray-200 bg-white overflow-hidden shrink-0 text-xs font-semibold">
              <button
                type="button"
                className="px-3.5 py-2.5 bg-amber-500 text-white"
              >
                List
              </button>
              <button
                type="button"
                className="px-3.5 py-2.5 text-gray-500 hover:bg-gray-50 transition-colors"
              >
                Map
              </button>
            </div>
          </div>

          {/* Filter label */}
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Filter Results
          </p>

          {/* Scrollable chip row — bleeds to screen edges on mobile */}
          <div className="chips-scroll overflow-x-auto -mx-4 px-4">
            <div className="chips-inner flex gap-2 w-max pb-0.5">
              {FILTER_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="px-3.5 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-700 whitespace-nowrap hover:bg-gray-50 transition-colors shrink-0"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Venue list */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        <p className="text-sm font-semibold text-gray-700 mb-4">All Venues</p>

        {venues.length === 0 ? (
          <p className="text-gray-500 text-sm">No venues available right now.</p>
        ) : (
          <VenueList venues={venues} />
        )}
      </div>
    </main>
  );
}
