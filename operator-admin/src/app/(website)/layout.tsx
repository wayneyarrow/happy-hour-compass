import type { ReactNode } from "react";
import Link from "next/link";
import WebsiteHeader from "./WebsiteHeader";
import type { ConsumerUser } from "./WebsiteHeader";
import { ConsumerAuthProvider } from "./ConsumerAuthProvider";
import { getActiveMarket } from "@/lib/activeMarket";
import { createClient } from "@/lib/supabase/server";
import {
  getMarketBySlug,
  getCitiesWithVenues,
  getDefaultCityForMarket,
} from "@/lib/geo/geography";
import type { CityRecord } from "@/lib/geo/types";

export default async function WebsiteLayout({ children }: { children: ReactNode }) {
  const { market } = await getActiveMarket();

  // Resolve consumer auth state for header rendering and saved-sync provider.
  let consumerUser: ConsumerUser | null = null;
  let consumerId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("consumer_profiles")
        .select("display_name, email")
        .eq("id", user.id)
        .maybeSingle();
      // Only treat the user as a signed-in consumer if a consumer_profiles row
      // actually exists. Operator-only auth users must NOT appear in the public
      // website header.
      if (profile) {
        consumerUser = {
          email: profile.email,
          displayName: profile.display_name ?? null,
        };
        consumerId = user.id;
      }
    }
  } catch {
    // Auth unavailable — fall back to signed-out header.
  }

  // Attempt DB-backed geography resolution. Falls back gracefully to the
  // config-layer market name when the DB is unavailable or not yet seeded.
  let cities: CityRecord[] = [];
  let currentCityName = market.name;

  try {
    // market.id == slug in both markets.ts config and the DB markets table.
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
    // DB unavailable — header falls back to market name label. Cookie flow
    // (hhc_market) continues to function unchanged.
  }

  return (
    <ConsumerAuthProvider consumerId={consumerId}>
      <div className="min-h-screen bg-white flex flex-col">
        <WebsiteHeader
          marketId={market.id}
          marketName={market.name}
          currentCityName={currentCityName}
          cities={cities}
          consumerUser={consumerUser}
        />

        <main className="flex-1">{children}</main>

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
    </ConsumerAuthProvider>
  );
}
