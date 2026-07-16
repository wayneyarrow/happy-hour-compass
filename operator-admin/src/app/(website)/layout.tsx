import type { ReactNode } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import WebsiteHeader from "./WebsiteHeader";
import { WebsiteFooter } from "./WebsiteFooter";
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

// Public-website-only, additive to the existing first-party analytics
// pipeline (src/lib/analytics.ts, @vercel/analytics, /api/track/*).
// Deliberately scoped to this layout rather than the root layout so
// Operator Admin and Founder Control Panel activity is never sent to GA4.
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

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

        <WebsiteFooter />
      </div>
      {GA_MEASUREMENT_ID && <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />}
    </ConsumerAuthProvider>
  );
}
