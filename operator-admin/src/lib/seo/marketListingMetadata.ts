import type { Metadata } from "next";
import { getMarketById, resolveMarketLocationLabel, type Market } from "@/lib/markets";
import { getDefaultCityForMarket, getMarketBySlug } from "@/lib/geo/geography";
import { getDiscoveryDestination, type DiscoveryMode } from "@/lib/homepageDiscoveryModes";
import { buildPageMetadata } from "@/lib/seo/metadata";

/**
 * Market listing URLs: /{market}/happy-hours, /{market}/daily-specials and
 * /{market}/events ([market]/happy-hours/page.tsx and siblings). Each always
 * shows its own market, whatever the visitor's saved market or country, and
 * is self-canonical, indexable (outside staging) and in the sitemap.
 * Server-only (DB lookups for the location label).
 */

/** The active market for a /{market}/… listing URL, or null (the route 404s). Coming Soon markets have no listings. */
export function getListingMarketForSlug(slug: string): Market | null {
  const market = getMarketById(slug);
  return market?.status === "active" ? market : null;
}

/**
 * The name searchers use for the market: the default city for a market
 * centred on one city (Central Okanagan → "Kelowna"), the market name for a
 * multi-city region (Greater San Diego). The same label the homepage hero
 * and header chip show (resolveMarketLocationLabel). Falls back to the
 * market name if the DB lookup fails.
 */
async function getMarketSearchLabel(market: Market): Promise<string> {
  try {
    const record = await getMarketBySlug(market.id);
    const defaultCity = record ? await getDefaultCityForMarket(record.id) : null;
    return resolveMarketLocationLabel(market, defaultCity?.name);
  } catch {
    return market.name;
  }
}

const LISTING_COPY: Record<DiscoveryMode, { title: (place: string) => string; description: (place: string) => string }> = {
  happy_hours: {
    title: (place) => `Happy Hours in ${place}`,
    description: (place) =>
      `Find happy hour deals in ${place}: drink and food specials at local bars and restaurants, filterable by day and time.`,
  },
  daily_specials: {
    title: (place) => `Daily Specials in ${place}`,
    description: (place) => `Browse today's food and drink specials at bars and restaurants in ${place}, updated in real time.`,
  },
  events: {
    title: (place) => `Events in ${place}`,
    description: (place) =>
      `Find upcoming events at bars and restaurants in ${place}, filterable by date, type and venue.`,
  },
};

/**
 * Metadata for a market listing URL. Plain-string title, so the root layout's
 * template adds "— Happy Hour Compass" once. Canonical is the listing's own
 * URL; query parameters (filters, ?q=) are not part of it, matching the
 * legacy /website-… listings.
 */
export async function buildMarketListingMetadata(mode: DiscoveryMode, market: Market): Promise<Metadata> {
  const place = await getMarketSearchLabel(market);
  const copy = LISTING_COPY[mode];
  return buildPageMetadata({
    title: copy.title(place),
    description: copy.description(place),
    path: getDiscoveryDestination(mode, market.id),
  });
}
