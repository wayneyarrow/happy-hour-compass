import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getMarketById } from "@/lib/markets";
import { getGuideLibraryForMarket } from "@/lib/data/contentGuideDistribution";
import { GuideCard } from "@/app/(website)/GuideCard";
import { buildBreadcrumbListNode } from "@/lib/seo/schema/breadcrumb";
import { JsonLd } from "@/app/(website)/JsonLd";
import { buildPageMetadata, buildComingSoonMetadata } from "@/lib/seo/metadata";
import { MarketComingSoon } from "@/app/(website)/MarketComingSoon";
import { getPublicCollectionModel } from "@/lib/data/collectionPublic";
import {
  applyGuidesLibraryRobots,
  getGuidesLibraryState,
  resolveDormantGuidesCta,
  FEATURED_GUIDES_COLLECTION_SLUG,
} from "@/lib/guidesLibraryState";

/**
 * Public Guides Library (Card 6B Part 4). Canonical URL: /{market}/guides —
 * this is the canonical distribution destination; the homepage Featured
 * Guides rail is just a curated subset of the same merchandising data (see
 * getFeaturedGuidesForMarket in contentGuideDistribution.ts).
 *
 * Only shows guides that are eligible + actively merchandised in the
 * 'guides_library' channel + published + inside their publish window —
 * getGuideLibraryForMarket enforces all four via isGuidePublicNow() and the
 * content_guide_channels → content_guide_placements FK chain. No publish
 * logic is duplicated here.
 *
 * Zero library guides = DORMANT: still 200 + self-canonical, but
 * noindex/follow, out of sitemap.xml, and shows a pointer to the Featured
 * Guides collection instead of the card grid. One active guides_library
 * placement makes it ACTIVE automatically. See src/lib/guidesLibraryState.ts
 * (incl. its TODO(multi-market)) for why.
 */

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ market: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { market } = await params;
  const marketConfig = getMarketById(market);
  // Invalid market — the page body itself calls notFound() for this same
  // condition, so this fallback title is a defensive value, not the tag an
  // indexable page needs; no canonical is meaningful for a route that
  // doesn't resolve, so this intentionally stays outside buildPageMetadata.
  if (!marketConfig) return { title: "Guides" };

  // Launch config: same noindex gate as the venue/event/collection/guide
  // detail pages — see MarketComingSoon.tsx, which this metadata pairs with.
  if (marketConfig.status !== "active") {
    return buildComingSoonMetadata(marketConfig.name);
  }

  const guides = await getGuideLibraryForMarket(market);

  return applyGuidesLibraryRobots(
    buildPageMetadata({
      title: `Guides | ${marketConfig.name}`,
      description: `Editorial guides to the best happy hours and events in ${marketConfig.name}, curated by Happy Hour Compass.`,
      path: `/${market}/guides`,
    }),
    getGuidesLibraryState(guides.length)
  );
}

export default async function GuidesLibraryPage({ params }: PageProps) {
  const { market } = await params;
  const marketConfig = getMarketById(market);
  if (!marketConfig) notFound();

  // Launch config: a market that isn't active shows the shared branded
  // Coming Soon experience instead of real content.
  if (marketConfig.status !== "active") {
    return <MarketComingSoon marketName={marketConfig.name} />;
  }

  const guides = await getGuideLibraryForMarket(market);
  const libraryState = getGuidesLibraryState(guides.length);

  // Dormant only: link to the market's Featured Guides collection, but only
  // if it actually resolves (same rule its own page uses to 404) — otherwise
  // fall back to the homepage rather than linking to a dead URL.
  const dormantCta =
    libraryState === "dormant"
      ? resolveDormantGuidesCta(
          market,
          (await getPublicCollectionModel(market, FEATURED_GUIDES_COLLECTION_SLUG)) !== null
        )
      : null;

  // Home → Guides. This page IS the "Guides" destination guide detail
  // pages' own breadcrumb links to, so its own breadcrumb ends with
  // itself, same shape as the About page's Home → About Us. Matches the
  // same /{market}/guides path generateMetadata() above passes to
  // buildPageMetadata() as its canonical — built directly here rather than
  // threading a shared constant through, since it's a one-line template
  // with only these two call sites.
  const breadcrumbCanonicalPath = `/${market}/guides`;
  const breadcrumbNode = buildBreadcrumbListNode({
    canonicalPath: breadcrumbCanonicalPath,
    items: [
      { name: "Home", path: "/" },
      { name: "Guides", path: breadcrumbCanonicalPath },
    ],
  });

  return (
    <>
      <JsonLd nodes={[breadcrumbNode]} />
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10">
      <h1 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight mb-2">
        {marketConfig.name} Guides
      </h1>
      <p className="text-base text-gray-500 mb-10 max-w-2xl">
        Editorial guides to the best happy hours and events in {marketConfig.name}, curated
        by Happy Hour Compass.
      </p>

      {dormantCta ? (
        <div className="max-w-2xl rounded-2xl border border-gray-200 bg-gray-50 px-6 py-10 md:px-10">
          <h2 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight mb-3">
            Explore our {marketConfig.name} guides
          </h2>
          <p className="text-base text-gray-600 leading-relaxed mb-6">
            Browse our featured guides for the best happy hours, food deals, patios, events,
            and local recommendations across {marketConfig.name}.
          </p>
          <Link
            href={dormantCta.href}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
          >
            {dormantCta.label}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {guides.map((g) => (
            <GuideCard
              key={g.slug}
              guideId={g.id}
              title={g.title}
              href={`/${market}/guides/${g.slug}`}
              heroImageUrl={g.heroImageUrl}
            />
          ))}
        </div>
      )}
      </div>
    </>
  );
}
