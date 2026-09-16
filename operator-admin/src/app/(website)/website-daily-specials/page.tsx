import type { Metadata } from "next";
import { getActiveMarket } from "@/lib/activeMarket";
import { getPublishedDailySpecialsForWebsite } from "@/lib/data/dailySpecials";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { DailySpecialSearchResults } from "./DailySpecialSearchResults";

export const dynamic = "force-dynamic";

// A primary consumer discovery/search page (linked from the homepage and
// collections — see homepageDiscoveryModes.ts) — indexable in production
// like any other public page, via the same environment-aware
// buildPageMetadata()/shouldNoIndex() every other public route uses.
// Previously hardcoded robots: { index: false } unconditionally (in every
// environment, including production), which is what Google Search Console
// flagged as the cause of this route being unindexable in production.
export const metadata: Metadata = buildPageMetadata({
  title: "Daily Specials",
  description:
    "Browse today's daily food and drink specials at local bars and restaurants, updated in real time.",
  path: "/website-daily-specials",
});

export default async function DailySpecialsSearchPage() {
  const { market } = await getActiveMarket();
  const dailySpecials = await getPublishedDailySpecialsForWebsite(market);

  return <DailySpecialSearchResults dailySpecials={dailySpecials} market={market} enableFilterSync />;
}
