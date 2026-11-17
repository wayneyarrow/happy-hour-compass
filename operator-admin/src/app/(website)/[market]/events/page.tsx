import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedEventsForWebsite } from "@/lib/data/events";
import { buildMarketListingMetadata, getListingMarketForSlug } from "@/lib/seo/marketListingMetadata";
import { EventSearchResults } from "../../website-events/EventSearchResults";

/**
 * /{market}/events — the market's own Events listing. Always shows this
 * market, whatever the visitor's saved market or country, and never changes
 * that saved market. Same listing as the legacy /website-events, including
 * its query parameters. Event detail pages stay at
 * /{market}/{city}/events/{slug}. Coming Soon and unknown market slugs 404.
 */

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ market: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const market = getListingMarketForSlug((await params).market);
  return market ? buildMarketListingMetadata("events", market) : {};
}

export default async function MarketEventsPage({ params }: PageProps) {
  const market = getListingMarketForSlug((await params).market);
  if (!market) notFound();
  const events = await getPublishedEventsForWebsite(market, { scope: "assigned_market" });
  return <EventSearchResults events={events} market={market} enableFilterSync />;
}
