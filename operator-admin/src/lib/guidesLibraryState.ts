import type { Metadata } from "next";
import { buildCollectionLandingHref } from "@/lib/data/collectionsShared";

/**
 * Dormant/active state for a market's public Guides Library (/{market}/guides).
 *
 * Pure — no I/O. The ONLY input is the result of the existing library query,
 * getGuideLibraryForMarket() (contentGuideDistribution.ts), which already
 * enforces every library rule (active guides_library placement, published,
 * market match, publish window). There is deliberately no second definition
 * of "active library" anywhere: active = that query returned ≥1 guide.
 *
 *   dormant — page stays at its URL (200, self-canonical) but is
 *             noindex/follow, excluded from sitemap.xml, and shows a
 *             dormant state pointing at the Featured Guides collection.
 *   active  — normal indexable library, listed in sitemap.xml.
 *
 * TODO(multi-market): The Guides Library is intentionally dormant while
 * Featured Guides collections are the primary consumer guide experience
 * (HHC is currently primarily single-market). A market's library becomes
 * indexable and enters the sitemap automatically once it has one active
 * guides_library placement (Discover → Guides merchandising) — no code
 * change needed. When guide discovery expands across multiple active
 * markets, revisit Guides Library entry points: site nav/footer, market
 * homepage guide discovery, the "Guides" guide breadcrumb level, "Explore
 * all Guides" CTAs, and possible cross-market guide discovery.
 */

export type GuidesLibraryState = "active" | "dormant";

export function getGuidesLibraryState(libraryGuideCount: number): GuidesLibraryState {
  return libraryGuideCount > 0 ? "active" : "dormant";
}

/**
 * Adds noindex/follow to a dormant library's metadata. Never overrides
 * robots already set by buildPageMetadata() — on staging that is
 * noindex/nofollow via shouldNoIndex(), which must keep winning.
 */
export function applyGuidesLibraryRobots(metadata: Metadata, state: GuidesLibraryState): Metadata {
  if (state === "active" || metadata.robots) return metadata;
  return { ...metadata, robots: { index: false, follow: true } };
}

/** /{market}/guides paths for sitemap.xml — only markets whose library is active. */
export function buildGuideLibrarySitemapPaths(
  activeMarketSlugs: readonly string[],
  stateByMarket: ReadonlyMap<string, GuidesLibraryState>
): string[] {
  return activeMarketSlugs
    .filter((slug) => stateByMarket.get(slug) === "active")
    .map((slug) => `/${slug}/guides`);
}

/**
 * Known slug of each market's Featured Guides collection — the current
 * primary consumer guide destination (Homepage → Guides → View All).
 * Collections have no "primary guide collection" pointer, so the dormant
 * CTA depends on this slug by convention; the page verifies the collection
 * actually resolves (getPublicCollectionModel) before linking to it.
 */
export const FEATURED_GUIDES_COLLECTION_SLUG = "featured-guides";

export type DormantGuidesCta = { href: string; label: string };

/** Featured Guides collection when it resolves for this market, otherwise the homepage (which carries the guides section). */
export function resolveDormantGuidesCta(
  marketSlug: string,
  featuredGuidesAvailable: boolean
): DormantGuidesCta {
  return featuredGuidesAvailable
    ? {
        href: buildCollectionLandingHref(marketSlug, FEATURED_GUIDES_COLLECTION_SLUG),
        label: "Browse featured guides",
      }
    : { href: "/", label: "Explore Happy Hour Compass" };
}
