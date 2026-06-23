import type { MetadataRoute } from "next";
import { getSiteUrl, shouldNoIndex } from "@/lib/siteUrl";

/**
 * Main sitemap — served at /sitemap.xml.
 *
 * Phase 1 (now): framework placeholder — returns root URL only.
 * Staging: returns empty sitemap (blocked by robots.txt as well).
 *
 * Target architecture for Phase 2+:
 *
 *   /sitemap.xml             ← this file; will become a sitemap index
 *   /sitemaps/markets.xml    ← one entry per active market landing page
 *   /sitemaps/venues.xml     ← one entry per published venue (dynamic, all slugs)
 *   /sitemaps/events.xml     ← one entry per upcoming/active event
 *   /sitemaps/guides.xml     ← editorial guide pages (future content system)
 *
 * To implement sub-sitemaps in Next.js 15, create:
 *   app/sitemaps/venues/route.ts  → returns XML with all venue URLs
 *   app/sitemaps/events/route.ts  → returns XML with all event URLs
 * Then update this file to return a sitemap index pointing to each sub-sitemap.
 *
 * Note: Next.js MetadataRoute.Sitemap does not natively produce a sitemap index.
 * To output a sitemap index, use Route Handlers (e.g. app/sitemaps/venues/route.ts)
 * that return raw XML with Content-Type: application/xml.
 *
 * Data sources for Phase 2:
 *   Venues:  getPublishedVenuesForConsumer() in src/lib/data/venues.ts
 *   Events:  getEventsForConsumerVenues()    in src/lib/data/events.ts
 *   Markets: getActiveMarkets()              in src/lib/markets.ts
 */
export default function sitemap(): MetadataRoute.Sitemap {
  if (shouldNoIndex()) {
    return [];
  }

  const siteUrl = getSiteUrl();

  return [
    {
      url: `${siteUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];
}
