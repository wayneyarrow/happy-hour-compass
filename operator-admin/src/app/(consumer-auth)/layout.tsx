import type { ReactNode } from "react";
import Link from "next/link";
import WebsiteHeader from "@/app/(website)/WebsiteHeader";
import { getActiveMarket } from "@/lib/activeMarket";
import {
  getMarketBySlug,
  getCitiesWithVenues,
  getDefaultCityForMarket,
} from "@/lib/geo/geography";
import type { CityRecord } from "@/lib/geo/types";

export default async function ConsumerAuthLayout({ children }: { children: ReactNode }) {
  const { market } = await getActiveMarket();

  let cities: CityRecord[] = [];
  let currentCityName = market.name;

  try {
    const marketRecord = await getMarketBySlug(market.id);
    if (marketRecord) {
      const [allCities, defaultCity] = await Promise.all([
        getCitiesWithVenues(marketRecord.id),
        getDefaultCityForMarket(marketRecord.id),
      ]);
      cities = allCities;
      if (defaultCity) currentCityName = defaultCity.name;
    }
  } catch {
    // DB unavailable — header falls back gracefully
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <WebsiteHeader
        marketId={market.id}
        marketName={market.name}
        currentCityName={currentCityName}
        cities={cities}
        consumerUser={null}
      />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-12">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div>
              <p className="text-sm font-bold text-gray-900">
                Happy Hour <span className="text-amber-500">Compass</span>
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Find the best happy hours near you.
              </p>
            </div>
            <div className="flex items-center gap-6">
              <Link
                href="/suggest/owner"
                className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
              >
                List your venue
              </Link>
              <Link
                href="/login"
                className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
              >
                Operator login
              </Link>
            </div>
          </div>
          <p className="mt-8 text-xs text-gray-400">
            © {new Date().getFullYear()} Happy Hour Compass. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
