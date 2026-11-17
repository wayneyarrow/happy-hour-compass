import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedDailySpecialsForWebsite } from "@/lib/data/dailySpecials";
import { buildMarketListingMetadata, getListingMarketForSlug } from "@/lib/seo/marketListingMetadata";
import { DailySpecialSearchResults } from "../../website-daily-specials/DailySpecialSearchResults";

/**
 * /{market}/daily-specials — the market's own Daily Specials listing. Always
 * shows this market, whatever the visitor's saved market or country, and
 * never changes that saved market. Same listing as the legacy
 * /website-daily-specials, including its query parameters (?when=, ?type=,
 * ?q=). Coming Soon and unknown market slugs 404.
 */

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ market: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const market = getListingMarketForSlug((await params).market);
  return market ? buildMarketListingMetadata("daily_specials", market) : {};
}

export default async function MarketDailySpecialsPage({ params }: PageProps) {
  const market = getListingMarketForSlug((await params).market);
  if (!market) notFound();
  const dailySpecials = await getPublishedDailySpecialsForWebsite(market, { scope: "assigned_market" });
  return <DailySpecialSearchResults dailySpecials={dailySpecials} market={market} enableFilterSync />;
}
