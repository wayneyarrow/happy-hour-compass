import type { Metadata } from "next";
import { getActiveMarket } from "@/lib/activeMarket";
import { getPublishedDailySpecialsForWebsite } from "@/lib/data/dailySpecials";
import { DailySpecialSearchResults } from "./DailySpecialSearchResults";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Daily Specials",
  robots: { index: false },
};

export default async function DailySpecialsSearchPage() {
  const { market } = await getActiveMarket();
  const dailySpecials = await getPublishedDailySpecialsForWebsite(market);

  return <DailySpecialSearchResults dailySpecials={dailySpecials} market={market} enableFilterSync />;
}
