import type { Metadata } from "next";
import { getActiveMarket } from "@/lib/activeMarket";
import SearchContextHeader from "./SearchContextHeader";

export const metadata: Metadata = {
  title: "Happy Hours — Happy Hour Compass",
  robots: { index: false },
};

const FILTER_CHIPS = ["Near Me", "On Now", "Time", "Top Rated", "Type", "Sort"];

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
      <div className="flex gap-4">
        <div className="w-20 h-20 rounded-lg bg-gray-200 flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="h-4 bg-gray-200 rounded-md w-3/4" />
          <div className="h-3 bg-gray-200 rounded-md w-1/2" />
          <div className="h-3 bg-gray-200 rounded-md w-2/3" />
          <div className="flex gap-2 pt-1">
            <div className="h-5 w-16 bg-gray-200 rounded-full" />
            <div className="h-5 w-20 bg-gray-200 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

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
                text-sm font-medium text-gray-700
                hover:border-gray-300 hover:shadow-sm
                transition-all whitespace-nowrap
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400
              "
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop: 55/45 split layout */}
      <div className="hidden md:flex">
        {/* Results column — 55%, scrolls with the page */}
        <div className="w-[55%] min-h-[calc(100dvh-72px)] border-r border-gray-100 px-6 pt-8 pb-5">
          <SearchContextHeader market={market} className="mb-7" />

          <div className="space-y-3">
            {Array.from({ length: 8 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>

        {/* Map column — 45%, sticky within viewport */}
        <div className="w-[45%]">
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

        {/* Results placeholder */}
        <div className="px-4 pb-8 space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    </>
  );
}
