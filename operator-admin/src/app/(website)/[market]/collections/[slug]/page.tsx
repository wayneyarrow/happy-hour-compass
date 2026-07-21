import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { buildPageMetadata, buildComingSoonMetadata } from "@/lib/seo/metadata";
import {
  getPublicCollectionModel,
  generateCollectionFallbackDescription,
} from "@/lib/data/collectionPublic";
import { CollectionLandingShell } from "@/app/(website)/collections/CollectionLandingShell";
import { CollectionTypeContent } from "@/app/(website)/collections/CollectionTypeContent";
import { buildCollectionPageNode } from "@/lib/seo/schema/collection";
import { buildBreadcrumbListNode } from "@/lib/seo/schema/breadcrumb";
import { JsonLd } from "@/app/(website)/JsonLd";
import { getMarketById } from "@/lib/markets";
import { MarketComingSoon } from "@/app/(website)/MarketComingSoon";

/**
 * Public Collection Landing Page — /{market}/collections/{collection-slug}
 * (Collection Landing Pages — Shared Public Infrastructure task).
 *
 * Deliberately thin: all resolution/validation lives in
 * getPublicCollectionModel (collectionPublic.ts), all shared presentation
 * lives in CollectionLandingShell, and all future type-specific
 * presentation lives beneath CollectionTypeContent's per-kind components.
 * This route file only wires those three together and handles the 404
 * case — the same shape as the existing venue and guide detail pages
 * ((website)/[market]/[city]/[slug]/page.tsx,
 * (website)/[market]/guides/[slug]/page.tsx), which is also why there's no
 * header/footer here: (website)/layout.tsx already supplies both.
 */

type PageProps = {
  params: Promise<{ market: string; slug: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { market, slug } = await params;
  const model = await getPublicCollectionModel(market, slug);
  if (!model) return { title: "Collection" };

  // Launch config: same noindex gate as the venue/event pages — see
  // MarketComingSoon.tsx, which this metadata pairs with.
  const marketConfig = getMarketById(model.marketSlug);
  if (marketConfig && marketConfig.status !== "active") {
    return buildComingSoonMetadata(marketConfig.name);
  }

  const description = model.publicIntro?.trim() || generateCollectionFallbackDescription(model);

  return buildPageMetadata({
    title: model.name,
    description,
    path: `/${model.marketSlug}/collections/${model.slug}`,
  });
}

export default async function CollectionLandingPage({ params }: PageProps) {
  const { market, slug } = await params;

  const model = await getPublicCollectionModel(market, slug);
  if (!model) notFound();

  // Launch config: a market that isn't active shows the shared branded
  // Coming Soon experience instead of real content.
  const marketConfig = getMarketById(model.marketSlug);
  if (marketConfig && marketConfig.status !== "active") {
    return <MarketComingSoon marketName={marketConfig.name} />;
  }

  // Same canonical path template generateMetadata() above builds inline for
  // its <link rel="canonical"> tag — collections have no admin-editable
  // canonical override field, so this is a direct template, not a cascade;
  // kept identical here rather than introducing a new shared helper for a
  // template with only this one caller pair.
  const canonicalPath = `/${model.marketSlug}/collections/${model.slug}`;

  const collectionNode = buildCollectionPageNode({
    canonicalPath,
    name: model.name,
    publicIntro: model.publicIntro,
  });

  // Home → Collection Name only — no "Collections" level. Confirmed via
  // CollectionBreadcrumb.tsx's own doc comment: "'Collections' stays a
  // plain, non-linked label until a general Collections index page
  // exists, per product spec" — no such route exists, so there is no
  // real canonical URL a "Collections" breadcrumb level could point to.
  const breadcrumbNode = buildBreadcrumbListNode({
    canonicalPath,
    items: [
      { name: "Home", path: "/" },
      { name: model.name, path: canonicalPath },
    ],
  });

  return (
    <>
      <JsonLd nodes={[collectionNode, breadcrumbNode]} />
      <CollectionLandingShell model={model}>
        <CollectionTypeContent model={model} />
      </CollectionLandingShell>
    </>
  );
}
