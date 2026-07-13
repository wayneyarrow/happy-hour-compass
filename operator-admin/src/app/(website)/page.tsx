import type { Metadata } from "next";
import HeroSection from "./HeroSection";
import { HomepageSectionsRenderer } from "./homepage/HomepageSectionsRenderer";
import { getActiveMarket } from "@/lib/activeMarket";
import { getMarketBySlug, getDefaultCityForMarket } from "@/lib/geo/geography";
import type { Market } from "@/lib/markets";
import { getPublicHomepageForLocation } from "@/lib/data/homepagePublic";

// Resolves the consumer-facing city name (and slug, for public Homepage
// geography resolution — Task 8) for the hero's search placeholder. Mirrors
// the fallback pattern in layout.tsx's header city lookup — falls back to
// the market config name, with no city context, if the DB geography lookup
// is unavailable.
async function getHeroCityContext(market: Market): Promise<{ cityName: string; citySlug: string | null }> {
  try {
    const marketRecord = await getMarketBySlug(market.id);
    if (marketRecord) {
      const defaultCity = await getDefaultCityForMarket(marketRecord.id);
      if (defaultCity) return { cityName: defaultCity.name, citySlug: defaultCity.slug };
    }
  } catch {
    // DB unavailable — fall back to market config name.
  }
  return { cityName: market.name, citySlug: null };
}

const DEFAULT_METADATA: Metadata = {
  title: { absolute: "Happy Hour Compass — Find the best happy hours near you" },
  description:
    "Discover curated happy hour deals at bars and restaurants near you. Real menus, real prices, real hours — updated by the venues themselves.",
};

/**
 * Public Homepage SEO (Task 8 — Publishing and Public Homepage Integration).
 * Uses the SEO metadata belonging to the Homepage that is ACTUALLY
 * rendered — when a city falls back to its parent market Homepage, that
 * means the market Homepage's own SEO fields, never fabricated
 * city-specific metadata. Falls back to the site-wide defaults above for
 * any field the editor left empty, and to the defaults entirely when no
 * Homepage is published for this geography.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { market } = await getActiveMarket();
  const { citySlug } = await getHeroCityContext(market);
  const homepage = await getPublicHomepageForLocation(market.id, citySlug);
  if (!homepage) return DEFAULT_METADATA;

  const title = homepage.metaTitle ?? homepage.pageTitle;
  const description = homepage.metaDescription ?? undefined;
  const ogTitle = homepage.ogTitle ?? title ?? undefined;
  const ogDescription = homepage.ogDescription ?? description;

  return {
    title: title ? { absolute: title } : DEFAULT_METADATA.title,
    description: description ?? DEFAULT_METADATA.description,
    ...(homepage.canonicalUrl ? { alternates: { canonical: homepage.canonicalUrl } } : {}),
    ...(ogTitle || ogDescription ? { openGraph: { title: ogTitle, description: ogDescription } } : {}),
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────
// The Discovery Shell (header + Hero) is the only product-owned content
// below this point that is not driven by the Homepage CMS. Everything else
// on the public homepage is owned by the published Homepage's editorial
// Sections — there is no legacy static fallback content. When no Homepage
// is published for this geography (neither City nor Market), the page
// simply ends after the Hero; see docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md.

export default async function WebsiteHomePage() {
  const { market, isPersisted } = await getActiveMarket();
  const { cityName, citySlug } = await getHeroCityContext(market);
  const homepage = await getPublicHomepageForLocation(market.id, citySlug);

  return (
    <>
      <HeroSection market={market} cityName={cityName} isPersisted={isPersisted} />
      {homepage && <HomepageSectionsRenderer sections={homepage.sections} />}
    </>
  );
}
