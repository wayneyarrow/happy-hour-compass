import type { Metadata } from "next";
import { getActiveMarket } from "@/lib/activeMarket";
import { getPublishedEventsForWebsite } from "@/lib/data/events";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { EventSearchResults } from "./EventSearchResults";

export const dynamic = "force-dynamic";

// A primary consumer discovery/search page — architecturally identical to
// /website-happy-hours and /website-daily-specials (same homepage/collection
// entry points, same search-results shape) — indexable in production like
// any other public page, via the same environment-aware
// buildPageMetadata()/shouldNoIndex() every other public route uses.
// Previously hardcoded robots: { index: false } unconditionally (in every
// environment, including production). Fixed alongside the other two search
// pages for consistency — see the HHC SEO Indexing Audit report.
export const metadata: Metadata = buildPageMetadata({
  title: "Events",
  description:
    "Find upcoming events at local bars and restaurants, filterable by date, type, and venue.",
  path: "/website-events",
});

export default async function EventsSearchPage() {
  const { market } = await getActiveMarket();
  const events = await getPublishedEventsForWebsite(market);

  return <EventSearchResults events={events} market={market} enableFilterSync />;
}
