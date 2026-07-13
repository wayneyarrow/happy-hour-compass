/**
 * Homepage Preview data loader (Task 5 — Build Homepage Preview).
 *
 * Answers "what would this Homepage actually render right now?" for the
 * Control Panel preview route. Draft-inclusive for the Homepage itself
 * (mirrors getGuideForPreview's "no gate" pattern in contentGuides.ts) —
 * but every piece of assigned content is still checked against its OWN
 * public eligibility (published venue/event, published+in-window guide,
 * published+non-archived Collection), per
 * docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md's "an assigned
 * Collection with no eligible members does not render publicly" and this
 * task's "the content inside the preview should still respect each item's
 * own public eligibility."
 *
 * Section resolution itself (Collection algorithm/manual/boost resolution,
 * card mapping, Feature content eligibility) lives in homepagesRendering.ts
 * — shared verbatim with the Public loader (homepagePublic.ts, Task 8) so
 * Draft-inclusive Preview and published-only Public rendering can never
 * drift apart on "what does this Section actually render."
 *
 * Reuses, rather than duplicates:
 *   - getHomepageById (homepages.ts) — draft-inclusive Homepage + ordered Sections.
 *   - resolveSection / resolveDiscoveryShellGeography (homepagesRendering.ts)
 *     — the SAME Section resolution the Public loader uses.
 *
 * Geography: no second layer of picker-style filtering happens here. A
 * Section's Collection or Feature content was already geography-validated
 * against this Homepage at assignment time (homepages.ts); this loader only
 * re-checks CURRENT eligibility (published/in-window), not geography.
 */

import { getHomepageById } from "@/lib/data/homepages";
import type { HomepageStatus } from "@/lib/data/homepagesShared";
import { resolveSection, resolveDiscoveryShellGeography } from "@/lib/data/homepagesRendering";
import type { HomepagePreviewSection } from "@/lib/data/homepagesRendering";
import type { Market } from "@/lib/markets";
import type { CityRecord } from "@/lib/geo/types";

export type {
  HomepagePreviewGuideCard,
  HomepagePreviewFeatureCard,
  HomepagePreviewSection,
} from "@/lib/data/homepagesRendering";

export type HomepagePreviewData = {
  id: string;
  name: string;
  status: HomepageStatus;
  marketName: string;
  marketSlug: string;
  cityName: string | null;
  pageTitle: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  canonicalUrl: string | null;
  updatedAt: string;
  /** Everything the Discovery Shell (header + hero) needs, resolved from the Homepage's OWN geography — never the previewing editor's browser location. */
  discoveryShell: {
    market: Market;
    /** City label for the header/hero — this Homepage's own city, or the market's default city when this is a Market Homepage. */
    cityName: string;
    cities: CityRecord[];
  };
  /** Already filtered to sections that resolved to at least one usable item, in saved display order. */
  sections: HomepagePreviewSection[];
};

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Draft-inclusive Homepage preview loader — looks up by id (not a public
 * geography route), so it works identically for Draft/Published and
 * Market/City Homepages alike. Returns null only when the Homepage id itself
 * doesn't resolve (the preview route's notFound() trigger); every other
 * ineligibility (an empty Collection, an unpublished Feature target) is
 * absorbed into `sections` simply omitting that entry.
 */
export async function getHomepagePreviewData(homepageId: string): Promise<HomepagePreviewData | null> {
  const homepage = await getHomepageById(homepageId);
  if (!homepage) return null;

  const geo = await resolveDiscoveryShellGeography(homepage.marketId, homepage.cityId, homepage.cityName);

  const resolvedSections = await Promise.all(
    homepage.sections.map((section) => resolveSection(section, geo.marketSlug))
  );
  const sections = resolvedSections.filter((s): s is HomepagePreviewSection => s !== null);

  return {
    id: homepage.id,
    name: homepage.name,
    status: homepage.status,
    marketName: homepage.marketName,
    marketSlug: geo.marketSlug,
    cityName: homepage.cityName,
    pageTitle: homepage.pageTitle,
    metaTitle: homepage.metaTitle,
    metaDescription: homepage.metaDescription,
    ogTitle: homepage.ogTitle,
    ogDescription: homepage.ogDescription,
    canonicalUrl: homepage.canonicalUrl,
    updatedAt: homepage.updatedAt,
    discoveryShell: {
      market: geo.market,
      cityName: geo.cityName,
      cities: geo.cities,
    },
    sections,
  };
}
