import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/metadata";
import {
  getPublicCollectionModel,
  generateCollectionFallbackDescription,
} from "@/lib/data/collectionPublic";
import { CollectionLandingShell } from "@/app/(website)/collections/CollectionLandingShell";
import { CollectionTypeContent } from "@/app/(website)/collections/CollectionTypeContent";

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

  return (
    <CollectionLandingShell model={model}>
      <CollectionTypeContent model={model} />
    </CollectionLandingShell>
  );
}
