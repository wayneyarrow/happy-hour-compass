import type { Metadata } from "next";
import { getWebsiteActiveMarket } from "@/lib/activeMarket";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { HappyHoursListing, type HappyHoursSearchParams } from "./HappyHoursListing";

// A primary consumer discovery/search page (linked from the homepage,
// collections, and 404/coming-soon fallbacks — see homepageDiscoveryModes.ts
// and CollectionTypeContent.tsx) — indexable in production like any other
// public page, via the same environment-aware buildPageMetadata()/
// shouldNoIndex() every other public route uses. Previously hardcoded
// robots: { index: false } unconditionally (in every environment, including
// production), which is what Google Search Console flagged as the cause of
// this route being unindexable in production.
export const metadata: Metadata = buildPageMetadata({
  title: "Happy Hours",
  description:
    "Find happy hour deals near you — real-time drink and food specials at local bars and restaurants, filterable by day and time.",
  path: "/website-happy-hours",
});

// force-dynamic ensures the market cookie and venue data are always fresh.
export const dynamic = "force-dynamic";

// The legacy market-less URL, kept for existing links: it shows the
// visitor's saved market, else their country. Links that know their market
// use /{market}/happy-hours instead (getDiscoveryDestination).
export default async function HappyHoursSearchPage({ searchParams }: { searchParams: HappyHoursSearchParams }) {
  const { market } = await getWebsiteActiveMarket();
  return <HappyHoursListing market={market} searchParams={searchParams} />;
}
