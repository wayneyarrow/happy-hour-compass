import { createAdminClient } from "@/lib/supabase/server";
import { isGuidePublicNow } from "@/lib/data/contentGuides";
import { buildCollectionLandingHref } from "@/lib/data/collectionsShared";
import { FEATURED_GUIDES_COLLECTION_SLUG } from "@/lib/guidesLibraryState";

/**
 * "Guides" link target for the public website header/footer: the market's
 * Featured Guides collection page, or null when that page would not render.
 *
 * Mirrors the Guide branch of the collection page's own eligibility
 * (getPublicCollectionModel → getPublishedCollectionBySlug →
 * resolveManualGuides → getSavedGuideCardsByIds) in one query instead of
 * loading the full collection model:
 *   - collection in this market, slug featured-guides, status published,
 *     not archived, collection_type guide;
 *   - at least one attached guide that is published and inside its publish
 *     window (isGuidePublicNow) — an empty collection 404s, so status alone
 *     is not enough.
 *
 * Resolved once per request by (website)/layout.tsx and passed to both the
 * header and footer. Any failure returns null — the link is omitted and the
 * page renders normally.
 */

type GuideWindowRow = {
  status: string;
  publish_at: string | null;
  expire_at: string | null;
} | null;

export type FeaturedGuidesNavRow = {
  collection_type: string;
  collection_guide_items: { guide: GuideWindowRow }[] | null;
} | null;

/** Pure decision — the collection row (already filtered by market/slug/status/archived) → href or null. */
export function resolveFeaturedGuidesNavHref(
  marketSlug: string,
  row: FeaturedGuidesNavRow
): string | null {
  if (!row || row.collection_type !== "guide") return null;
  const hasEligibleGuide = (row.collection_guide_items ?? []).some(
    (item) =>
      item.guide !== null &&
      isGuidePublicNow(item.guide.status, item.guide.publish_at ?? null, item.guide.expire_at ?? null)
  );
  return hasEligibleGuide ? buildCollectionLandingHref(marketSlug, FEATURED_GUIDES_COLLECTION_SLUG) : null;
}

export async function getFeaturedGuidesNavHref(
  marketId: string,
  marketSlug: string
): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("collections")
      .select("collection_type, collection_guide_items(guide:content_guides(status, publish_at, expire_at))")
      .eq("market_id", marketId)
      .eq("slug", FEATURED_GUIDES_COLLECTION_SLUG)
      .eq("status", "published")
      .is("archived_at", null)
      .maybeSingle();

    if (error) {
      console.error("[getFeaturedGuidesNavHref]", error.message);
      return null;
    }
    return resolveFeaturedGuidesNavHref(marketSlug, data as unknown as FeaturedGuidesNavRow);
  } catch (err) {
    console.error("[getFeaturedGuidesNavHref] Unexpected error:", err);
    return null;
  }
}
