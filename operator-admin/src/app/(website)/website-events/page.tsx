import type { Metadata } from "next";
import { getActiveMarket } from "@/lib/activeMarket";
import { getPublishedEventsForWebsite } from "@/lib/data/events";
import { EventSearchResults } from "./EventSearchResults";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events",
  robots: { index: false },
};

export default async function EventsSearchPage() {
  const { market } = await getActiveMarket();
  const events = await getPublishedEventsForWebsite(market);

  return <EventSearchResults events={events} market={market} enableFilterSync />;
}
