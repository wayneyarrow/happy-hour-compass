import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/siteUrl";
import { MARKETS } from "@/lib/markets";
import { getAllMarkets } from "@/lib/geo/geography";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { getPublishedEventsForConsumer } from "@/lib/data/events";
import { getCollections } from "@/lib/data/collections";
import { getAllPublicGuidesForSitemap } from "@/lib/data/contentGuides";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";

// Content changes constantly (venues, events, collections, guides) — always
// read fresh, same as the public pages the sitemap links to.
export const dynamic = "force-dynamic";

/**
 * Main sitemap — served at /sitemap.xml.
 *
 * Built directly from live published content via the shared data layer
 * (src/lib/data/*). Every visibility rule here is reused from the same
 * helper the corresponding page itself uses to decide whether to render or
 * 404 — is_published for venues/events, status='published' + archived_at
 * IS NULL for collections, isGuidePublicNow() for guides — never
 * re-implemented. lastModified is set only from a real updated_at column;
 * pages with no such source (static marketing pages) omit it rather than
 * inventing one.
 *
 * Deliberately NOT gated on shouldNoIndex()/NEXT_PUBLIC_NOINDEX — that flag
 * only controls crawl PERMISSION (robots.txt's Disallow, and each page's own
 * <meta name="robots"> tag), which already fully blocks staging from being
 * crawled regardless of what this file returns. Every URL listed here is
 * already public (same is_published/status='published' data a visitor can
 * load directly), so there is nothing extra to protect by also emptying the
 * sitemap — doing so only broke the ability to verify the real sitemap
 * output on staging before launch.
 *
 * Each data source is fetched via Promise.allSettled, not Promise.all, so a
 * single failing source (e.g. a transient Supabase error) can never wipe out
 * the static pages or the other, healthy sources — see settled() below.
 *
 * Deliberately excluded: admin/operator/control-panel routes, auth/account/
 * saved pages, the /website-events and /website-happy-hours search-results
 * pages (both already noindex'd at the page level via their own metadata),
 * preview/draft content, unpublished content, and the legacy
 * /{market}/venue/{slug} redirect route.
 *
 * To add a new public content type: fetch it alongside the others below,
 * map each row to { url, lastModified? }, and flatten it into the returned
 * array.
 */

/** Unwraps a settled data-fetch result, logging and defaulting to [] on failure so one bad source never takes down the rest of the sitemap. */
function settled<T>(result: PromiseSettledResult<T[]>, label: string): T[] {
  if (result.status === "fulfilled") return result.value;
  console.error(`[sitemap] ${label} failed — omitting from this run:`, result.reason);
  return [];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [venuesResult, eventsResult, collectionsResult, guidesResult, marketsResult] =
    await Promise.allSettled([
      getPublishedVenuesForConsumer(),
      getPublishedEventsForConsumer(),
      getCollections({ status: "published", lifecycle: "active" }),
      getAllPublicGuidesForSitemap(),
      getAllMarkets(),
    ]);

  const venues = settled(venuesResult, "getPublishedVenuesForConsumer");
  const events = settled(eventsResult, "getPublishedEventsForConsumer");
  const collections = settled(collectionsResult, "getCollections");
  const guides = settled(guidesResult, "getAllPublicGuidesForSitemap");
  const dbMarkets = settled(marketsResult, "getAllMarkets");

  // Collections carry a DB market_id (UUID), not a slug — resolve via the
  // same DB markets table venues/guides already join against.
  const marketSlugByDbId = new Map(dbMarkets.map((m) => [m.id, m.slug]));

  // The guides library index (/{market}/guides) exists once per live
  // market regardless of how many guides that market currently has —
  // MARKETS is the same static "is this market live" source every other
  // website route already relies on (see src/lib/markets.ts).
  const activeMarketSlugs = MARKETS.filter((m) => m.status === "active").map((m) => m.id);

  // ── Static marketing pages — no real updated_at source, so no lastModified ──
  const staticPages: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/") },
    { url: absoluteUrl("/about") },
    { url: absoluteUrl("/business") },
    { url: absoluteUrl("/claim-your-venue") },
    { url: absoluteUrl("/careers") },
    { url: absoluteUrl("/privacy") },
    { url: absoluteUrl("/terms") },
  ];

  // ── Per-market guide library index pages ────────────────────────────────
  const guideLibraryPages: MetadataRoute.Sitemap = activeMarketSlugs.map((marketSlug) => ({
    url: absoluteUrl(`/${marketSlug}/guides`),
  }));

  // ── Published venue pages ───────────────────────────────────────────────
  const venuePages: MetadataRoute.Sitemap = venues.flatMap((venue) => {
    const path = buildVenuePublicPath({
      marketSlug: venue.marketSlug,
      citySlug: venue.citySlug,
      slug: venue.id,
    });
    if (!path) return [];
    return [
      {
        url: absoluteUrl(path),
        ...(venue.updatedAt ? { lastModified: new Date(venue.updatedAt) } : {}),
      },
    ];
  });

  // ── Published event pages ───────────────────────────────────────────────
  const eventPages: MetadataRoute.Sitemap = events.map((event) => ({
    url: absoluteUrl(`/website-events/${event.id}`),
    ...(event.updatedAt ? { lastModified: new Date(event.updatedAt) } : {}),
  }));

  // ── Collection landing pages ────────────────────────────────────────────
  const collectionPages: MetadataRoute.Sitemap = collections.flatMap((collection) => {
    const marketSlug = marketSlugByDbId.get(collection.marketId);
    if (!marketSlug) return [];
    return [
      {
        url: absoluteUrl(`/${marketSlug}/collections/${collection.slug}`),
        ...(collection.updatedAt ? { lastModified: new Date(collection.updatedAt) } : {}),
      },
    ];
  });

  // ── Guide detail pages ───────────────────────────────────────────────────
  const guidePages: MetadataRoute.Sitemap = guides.map((guide) => ({
    url: absoluteUrl(`/${guide.marketSlug}/guides/${guide.slug}`),
    ...(guide.updatedAt ? { lastModified: new Date(guide.updatedAt) } : {}),
  }));

  return [
    ...staticPages,
    ...guideLibraryPages,
    ...venuePages,
    ...eventPages,
    ...collectionPages,
    ...guidePages,
  ];
}
