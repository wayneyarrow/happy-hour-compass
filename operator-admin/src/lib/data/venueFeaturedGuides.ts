import { createAdminClient } from "@/lib/supabase/server";
import { isGuidePublicNow } from "@/lib/data/contentGuides";
import { buildGuidePublicPath } from "@/lib/guideSlugHistory";

/**
 * Public "Featured in" guide links for a venue detail page.
 *
 * Reads only the structured content_guide_venues attachments (migration
 * 053) — never editorial text. A guide qualifies only when its own public
 * detail page would render (same rules as getPublicGuideByMarketAndSlug):
 * venue guide, status published, inside its publish window
 * (isGuidePublicNow), in the venue's market. It does NOT need to be in the
 * Featured Guides collection.
 *
 * Deliberately separate from getVenueFeaturedContent()
 * (contentGuideAttachments.ts) — that Control Panel helper returns drafts.
 *
 * One query per venue page. Order matches getRelatedGuides (publish_at
 * newest first, nulls last), then title for a stable tie-break. Any failure
 * returns [] so the venue page renders without the section.
 */

export const VENUE_FEATURED_GUIDES_LIMIT = 6;

export type VenueFeaturedGuideLink = { href: string; title: string; heroImageUrl: string | null };

export type VenueFeaturedGuideRow = {
  title: string;
  slug: string;
  status: string;
  guide_type: string;
  publish_at: string | null;
  expire_at: string | null;
  hero_image_url: string | null;
  markets: { slug: string } | null;
};

/** Pure eligibility/ordering — rows from the query below → canonical guide links. */
export function selectVenueFeaturedGuideLinks(
  rows: VenueFeaturedGuideRow[],
  venueMarketSlug: string
): VenueFeaturedGuideLink[] {
  return rows
    .filter(
      (row) =>
        row.guide_type === "venue_guide" &&
        row.markets?.slug === venueMarketSlug &&
        isGuidePublicNow(row.status, row.publish_at ?? null, row.expire_at ?? null)
    )
    .sort((a, b) => {
      const at = a.publish_at ? Date.parse(a.publish_at) : null;
      const bt = b.publish_at ? Date.parse(b.publish_at) : null;
      if (at !== bt) {
        if (at === null) return 1;
        if (bt === null) return -1;
        return bt - at;
      }
      return a.title.localeCompare(b.title);
    })
    .slice(0, VENUE_FEATURED_GUIDES_LIMIT)
    .map((row) => ({
      href: buildGuidePublicPath(venueMarketSlug, row.slug),
      title: row.title,
      heroImageUrl: row.hero_image_url ?? null,
    }));
}

export async function getPublicGuidesFeaturingVenue(
  venueUuid: string,
  venueMarketSlug: string | null
): Promise<VenueFeaturedGuideLink[]> {
  if (!venueMarketSlug) return [];
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("content_guides")
      .select(
        "title, slug, status, guide_type, publish_at, expire_at, hero_image_url, " +
          "markets!inner(slug), content_guide_venues!inner(venue_id)"
      )
      .eq("content_guide_venues.venue_id", venueUuid)
      .eq("markets.slug", venueMarketSlug)
      .eq("guide_type", "venue_guide")
      .eq("status", "published");

    if (error) {
      console.error("[getPublicGuidesFeaturingVenue]", error.message);
      return [];
    }
    return selectVenueFeaturedGuideLinks((data ?? []) as unknown as VenueFeaturedGuideRow[], venueMarketSlug);
  } catch (err) {
    console.error("[getPublicGuidesFeaturingVenue] Unexpected error:", err);
    return [];
  }
}
