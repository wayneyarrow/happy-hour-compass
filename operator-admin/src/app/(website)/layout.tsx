import type { ReactNode } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import { WebsiteShellFooter, WebsiteShellHeader, type ShellMarketData } from "./WebsiteShellChrome";
import type { ConsumerUser } from "./WebsiteHeader";
import { ConsumerAuthProvider } from "./ConsumerAuthProvider";
import { JsonLd } from "./JsonLd";
import { buildOrganizationNode } from "@/lib/seo/schema/organization";
import { buildWebSiteNode } from "@/lib/seo/schema/website";
import { getWebsiteActiveMarket } from "@/lib/activeMarket";
import { createClient } from "@/lib/supabase/server";
import {
  getMarketBySlug,
  getCitiesWithVenues,
  getDefaultCityForMarket,
} from "@/lib/geo/geography";
import { MARKETS, resolveMarketLocationLabel, type Market } from "@/lib/markets";
import { getFeaturedGuidesNavHref } from "@/lib/data/featuredGuidesNav";
import { getNewsletterSignupHref } from "@/lib/weeklyPicks/newsletterAvailability";

// Public-website-only, additive to the existing first-party analytics
// pipeline (src/lib/analytics.ts, @vercel/analytics, /api/track/*).
// Deliberately scoped to this layout rather than the root layout so
// Operator Admin and Founder Control Panel activity is never sent to GA4.
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export default async function WebsiteLayout({ children }: { children: ReactNode }) {
  // The visitor's market (saved choice, else country). Pages under a market's
  // URL show their own market instead; WebsiteShellChrome picks between the
  // two in the browser from the current URL, so it stays right on
  // client-side navigation (this layout isn't re-rendered then).
  const { market } = await getWebsiteActiveMarket();

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

  // Header/footer data for every active market (two today), so the shell can
  // follow the page's market on any navigation without another request.
  const shellMarkets = await Promise.all(
    MARKETS.filter((m) => m.status === "active").map((m) => getShellMarketData(m))
  );

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
        <WebsiteShellHeader markets={shellMarkets} visitorMarketId={market.id} consumerUser={consumerUser} />

        <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">{children}</main>

        <WebsiteShellFooter markets={shellMarkets} visitorMarketId={market.id} />
      </div>
      <JsonLd nodes={[organizationNode, websiteNode]} />
      {GA_MEASUREMENT_ID && <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />}
    </ConsumerAuthProvider>
  );
}

/**
 * One market's header/footer data: its cities, location label, Guides link
 * and newsletter link. Falls back to the market's config name with no cities
 * or Guides link when the DB geography lookup is unavailable or not seeded.
 */
async function getShellMarketData(market: Market): Promise<ShellMarketData> {
  const data: ShellMarketData = {
    marketId: market.id,
    marketName: market.name,
    currentCityName: market.name,
    cities: [],
    // "Guides" nav target — null (link omitted) unless this market's Featured
    // Guides collection page would actually render. See featuredGuidesNav.ts.
    featuredGuidesHref: null,
    newsletterHref: getNewsletterSignupHref(market.id),
  };
  try {
    // market.id == slug in both markets.ts config and the DB markets table.
    const marketRecord = await getMarketBySlug(market.id);
    if (marketRecord) {
      const [allCities, defaultCity, guidesHref] = await Promise.all([
        getCitiesWithVenues(marketRecord.id),
        getDefaultCityForMarket(marketRecord.id),
        getFeaturedGuidesNavHref(marketRecord.id, market.id),
      ]);
      data.cities = allCities;
      data.featuredGuidesHref = guidesHref;
      data.currentCityName = resolveMarketLocationLabel(market, defaultCity?.name);
    }
  } catch {
    // DB unavailable — keep the config-layer fallback.
  }
  return data;
}
