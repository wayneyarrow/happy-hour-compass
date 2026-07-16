import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getPublicGuideByMarketAndSlug,
  getRelatedGuides,
} from "@/lib/data/contentGuides";
import {
  getGuideVenueAttachments,
  getGuideEventAttachments,
} from "@/lib/data/contentGuideAttachments";
import { getGuideFaqs } from "@/lib/data/faqLibrary";
import { getPublishedVenuesByUuids, type ConsumerVenue } from "@/lib/data/venues";
import { getPublishedEventsByIds, type WebsiteEventListItem } from "@/lib/data/events";
import { computeHhStatus } from "@/lib/happyHourStatus";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { generateGuideSeo } from "@/lib/seo/contentGuideSeo";
import type { SearchResultCardData } from "@/app/(website)/website-happy-hours/SearchResultCard";
import { GuideDetailView } from "./GuideDetailView";

/**
 * Public Content Engine guide page (Card 5).
 *
 * Canonical route: /{market}/guides/{guide-slug} — market here is the slug
 * shared 1:1 between src/lib/markets.ts and the DB `markets` table (see the
 * comment in (website)/layout.tsx). Guide data itself always comes from the
 * DB markets/cities/neighbourhoods tables via getPublicGuideByMarketAndSlug,
 * since that's what content_guides.market_id actually references.
 *
 * Scope: public rendering only. No Discover/homepage distribution, no
 * publishing-workflow changes, no curated Related Guides (that's an editor
 * feature that hasn't been built — see getRelatedGuides' docstring for the
 * safe substitute used here instead). Card 2D added FAQ rendering
 * (getGuideFaqs, GuideFaqSection) — see that component's docstring for the
 * FAQPage JSON-LD it also emits.
 *
 * Guide Experience V2 Card 2A extracted the actual guide-detail presentation
 * into GuideDetailView (same directory), so the Control Panel's admin-safe
 * preview route can render Draft and Published guides identically to this
 * page without a second, drift-prone copy of the markup. This file now only
 * owns metadata generation and the public-only data fetch/gating
 * (getPublicGuideByMarketAndSlug enforces published + in-window; the preview
 * route's getGuideForPreview deliberately does not).
 */

// Guides can be published/edited/expired at any time — always read fresh.
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ market: string; slug: string }>;
};

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { market, slug } = await params;
  const guide = await getPublicGuideByMarketAndSlug(market, slug);
  if (!guide) return { title: "Guide | Happy Hour Compass" };

  // Same generator the CP editor uses for live suggestions — reused here as
  // the fallback for any manual SEO field the admin left empty, so public
  // rendering and the editor's own preview never disagree.
  const fallback = generateGuideSeo({
    guideType: guide.guide_type,
    marketName: guide.marketName,
    marketSlug: guide.marketSlug,
    cityName: guide.cityName ?? "",
    neighbourhoodName: guide.neighbourhoodName,
    title: guide.title,
    slug: guide.slug,
    primaryKeyword: guide.primary_keyword,
    secondaryKeywords: guide.secondary_keywords,
    intro: guide.intro,
    editorialSection1Body: guide.editorial_section_1_body,
    body: guide.body,
  });

  // Cascade: manual value → the sibling meta field → the generator. This
  // way an admin who fills in Meta Title/Description but leaves OG blank
  // gets sensible OG copy instead of silently re-deriving it from scratch.
  const pageTitle = guide.page_title || fallback.page_title.value;
  const metaTitle = guide.meta_title || fallback.meta_title.value;
  const metaDescription = guide.meta_description || fallback.meta_description.value;
  const ogTitle = guide.og_title || metaTitle;
  const ogDescription = guide.og_description || metaDescription;
  // Only trust a manual canonical_url if it looks like a path — a malformed
  // override should never break the canonical tag, just fall back quietly.
  const canonicalPath =
    guide.canonical_url && guide.canonical_url.startsWith("/")
      ? guide.canonical_url
      : fallback.canonical_url.value;

  const base = buildPageMetadata({
    title: pageTitle,
    description: metaDescription,
    path: `/${guide.marketSlug}/guides/${guide.slug}`,
    canonicalPath,
    // hero_image_url may be null — /og-default.png isn't a real asset yet
    // (see metadata.ts), so fall back to the site logo instead of a 404.
    ogImage: guide.hero_image_url ?? "/logo.png",
    ogType: "article",
    ogTitle,
    ogDescription,
  });

  return {
    ...base,
    // page_title is meant to be the literal, full browser-tab title
    // (already brand-suffixed by the generator, or admin-authored in full)
    // — bypass the root layout's "%s — Happy Hour Compass" template so it
    // isn't double-branded.
    title: { absolute: pageTitle },
  };
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function fallbackImage(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar") || t.includes("brewery") || t.includes("pub"))
    return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function GuideDetailPage({ params }: PageProps) {
  const { market, slug } = await params;

  const guide = await getPublicGuideByMarketAndSlug(market, slug);
  if (!guide) notFound();

  const isVenueGuide = guide.guide_type === "venue_guide";

  const [attachments, relatedGuides, faqs] = await Promise.all([
    isVenueGuide ? getGuideVenueAttachments(guide.id) : getGuideEventAttachments(guide.id),
    getRelatedGuides(guide.marketSlug, guide.id),
    getGuideFaqs(guide.id),
  ]);
  const orderedIds = attachments.map((a) => a.id);

  // ── Load full venue/event records for the attached ids, then restore the
  // guide's saved order — bulk `.in()` fetches don't guarantee row order,
  // and any id that no longer resolves (unpublished/deleted since being
  // attached) is silently dropped rather than crashing the page.
  let venueCards: SearchResultCardData[] = [];
  let eventItems: WebsiteEventListItem[] = [];

  if (isVenueGuide && orderedIds.length > 0) {
    const venues = await getPublishedVenuesByUuids(orderedIds);
    const byId = new Map(venues.map((v) => [v.venueUuid, v]));
    // Venues with no assigned market/city yet (see buildVenuePublicPath)
    // have no canonical URL and are omitted from the attached list.
    venueCards = orderedIds
      .map((id) => byId.get(id))
      .filter((v): v is ConsumerVenue => Boolean(v))
      .flatMap((v) => {
        const href = buildVenuePublicPath({ marketSlug: v.marketSlug, citySlug: v.citySlug, slug: v.id });
        if (!href) return [];
        return [{
          id: v.id,
          venueUuid: v.venueUuid,
          href,
          name: v.name,
          image: v.images[0]?.url ?? fallbackImage(v.establishmentType),
          isVerified: v.isVerified,
          googleRating: v.googleRating,
          hhStatus: computeHhStatus(v.happyHourWeekly),
          distanceKm: null,
          establishmentType: v.establishmentType,
          foodSpecial: v.specialsFood[0] ?? undefined,
          drinkSpecial: v.specialsDrinks[0] ?? undefined,
        }];
      });
  } else if (!isVenueGuide && orderedIds.length > 0) {
    const events = await getPublishedEventsByIds(orderedIds);
    const byId = new Map(events.map((e) => [e.id, e]));
    eventItems = orderedIds
      .map((id) => byId.get(id))
      .filter((e): e is WebsiteEventListItem => Boolean(e));
  }

  return (
    <GuideDetailView
      guide={guide}
      isVenueGuide={isVenueGuide}
      venueCards={venueCards}
      eventItems={eventItems}
      relatedGuides={relatedGuides}
      faqs={faqs}
    />
  );
}
