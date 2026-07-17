import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getMarketById } from "@/lib/markets";
import { getGuideLibraryForMarket } from "@/lib/data/contentGuideDistribution";
import { GuideCard } from "@/app/(website)/GuideCard";
import { buildBreadcrumbListNode } from "@/lib/seo/schema/breadcrumb";
import { JsonLd } from "@/app/(website)/JsonLd";

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
 */

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ market: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { market } = await params;
  const marketConfig = getMarketById(market);
  if (!marketConfig) return { title: "Guides" };

  return {
    title: `Guides | ${marketConfig.name}`,
    description: `Editorial guides to the best happy hours and events in ${marketConfig.name}, curated by Happy Hour Compass.`,
  };
}

export default async function GuidesLibraryPage({ params }: PageProps) {
  const { market } = await params;
  const marketConfig = getMarketById(market);
  if (!marketConfig) notFound();

  const guides = await getGuideLibraryForMarket(market);

  // Home → Guides. This page IS the "Guides" destination guide detail
  // pages' own breadcrumb links to, so its own breadcrumb ends with
  // itself, same shape as the About page's Home → About Us. No explicit
  // canonical tag exists on this route (generateMetadata() above sets no
  // alternates.canonical, the same gap already reported for /about) — the
  // route is fixed and unambiguous per the {market} param, so the same
  // precedent applies: use it directly rather than inventing a competing
  // canonical system.
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

      {guides.length === 0 ? (
        <p className="text-sm text-gray-400">
          No guides have been published for {marketConfig.name} yet. Check back soon.
        </p>
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
