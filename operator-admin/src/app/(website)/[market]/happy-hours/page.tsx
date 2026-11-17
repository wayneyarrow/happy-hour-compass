import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildMarketListingMetadata, getListingMarketForSlug } from "@/lib/seo/marketListingMetadata";
import { HappyHoursListing, type HappyHoursSearchParams } from "../../website-happy-hours/HappyHoursListing";

/**
 * /{market}/happy-hours — the market's own Happy Hours listing. Always shows
 * this market (results, map and header), whatever the visitor's saved
 * market or country, and never changes that saved market. Same listing as
 * the legacy /website-happy-hours (HappyHoursListing), including its query
 * parameters (?q=, ?day=, ?now=, ?from=, ?to=). Coming Soon and unknown
 * market slugs 404.
 */

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ market: string }>; searchParams: HappyHoursSearchParams };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const market = getListingMarketForSlug((await params).market);
  return market ? buildMarketListingMetadata("happy_hours", market) : {};
}

export default async function MarketHappyHoursPage({ params, searchParams }: PageProps) {
  const market = getListingMarketForSlug((await params).market);
  if (!market) notFound();
  return <HappyHoursListing market={market} searchParams={searchParams} />;
}
