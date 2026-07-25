import type { ReactNode } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import WebsiteHeader from "./WebsiteHeader";
import { WebsiteFooter } from "./WebsiteFooter";
import type { ConsumerUser } from "./WebsiteHeader";
import { ConsumerAuthProvider } from "./ConsumerAuthProvider";
import { JsonLd } from "./JsonLd";
import { buildOrganizationNode } from "@/lib/seo/schema/organization";
import { buildWebSiteNode } from "@/lib/seo/schema/website";
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

  // Sitewide Organization + WebSite JSON-LD — rendered once here, in one
  // shared graph, so both appear on every public website page without each
  // page emitting its own copy. Organization stays first: WebSite's
  // `publisher` references it by @id, so defining it first in the graph
  // reads in the same order the reference resolves.
  const organizationNode = buildOrganizationNode();
  const websiteNode = buildWebSiteNode();

  return (
    <ConsumerAuthProvider consumerId={consumerId}>
      {/* Skip link — visually hidden until keyboard-focused; jumps straight
          to the <main> landmark below so keyboard users can bypass the
          header/nav on every page. `tabIndex={-1}` on <main> lets the
          browser move focus there on activation (native fragment-navigation
          focus behaviour only applies to focusable elements); it stays out
          of the normal Tab order otherwise. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-amber-700 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
      >
        Skip to main content
      </a>
      <div className="min-h-screen bg-white flex flex-col">
        <WebsiteHeader
          marketId={market.id}
          marketName={market.name}
          currentCityName={currentCityName}
          cities={cities}
          consumerUser={consumerUser}
        />

        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">{children}</main>

        <WebsiteFooter />
      </div>
      <JsonLd nodes={[organizationNode, websiteNode]} />
      {GA_MEASUREMENT_ID && <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />}
    </ConsumerAuthProvider>
  );
}
