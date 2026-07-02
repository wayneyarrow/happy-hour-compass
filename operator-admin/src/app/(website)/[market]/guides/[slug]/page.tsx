import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  getPublicGuideByMarketAndSlug,
  getRelatedGuides,
} from "@/lib/data/contentGuides";
import {
  getGuideVenueAttachments,
  getGuideEventAttachments,
} from "@/lib/data/contentGuideAttachments";
import { getPublishedVenuesByUuids, type ConsumerVenue } from "@/lib/data/venues";
import { getPublishedEventsByIds, type WebsiteEventListItem } from "@/lib/data/events";
import { computeHhStatus } from "@/lib/happyHourStatus";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { generateGuideSeo } from "@/lib/seo/contentGuideSeo";
import {
  SearchResultCard,
  type SearchResultCardData,
} from "@/app/(website)/website-happy-hours/SearchResultCard";
import { EventSearchCard } from "@/app/(website)/website-events/EventSearchCard";

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
 * publishing-workflow changes, no FAQ (content_guides has no FAQ column
 * yet), no curated Related Guides (that's an editor feature that hasn't
 * been built — see getRelatedGuides' docstring for the safe substitute used
 * here instead).
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function GuideDetailPage({ params }: PageProps) {
  const { market, slug } = await params;

  const guide = await getPublicGuideByMarketAndSlug(market, slug);
  if (!guide) notFound();

  const isVenueGuide = guide.guide_type === "venue_guide";

  const [attachments, relatedGuides] = await Promise.all([
    isVenueGuide ? getGuideVenueAttachments(guide.id) : getGuideEventAttachments(guide.id),
    getRelatedGuides(guide.marketSlug, guide.id),
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
    venueCards = orderedIds
      .map((id) => byId.get(id))
      .filter((v): v is ConsumerVenue => Boolean(v))
      .map((v) => ({
        id: v.id,
        venueUuid: v.venueUuid,
        href: `/${guide.marketSlug}/venue/${v.id}`,
        name: v.name,
        image: v.images[0]?.url ?? fallbackImage(v.establishmentType),
        isVerified: v.isVerified,
        googleRating: v.googleRating,
        hhStatus: computeHhStatus(v.happyHourWeekly),
        distanceKm: null,
        establishmentType: v.establishmentType,
        foodSpecial: v.specialsFood[0] ?? undefined,
        drinkSpecial: v.specialsDrinks[0] ?? undefined,
      }));
  } else if (!isVenueGuide && orderedIds.length > 0) {
    const events = await getPublishedEventsByIds(orderedIds);
    const byId = new Map(events.map((e) => [e.id, e]));
    eventItems = orderedIds
      .map((id) => byId.get(id))
      .filter((e): e is WebsiteEventListItem => Boolean(e));
  }

  const locationLabel =
    [guide.neighbourhoodName, guide.cityName].filter(Boolean).join(", ") || guide.marketName;

  return (
    <div className="bg-white pb-16">
      <div className="max-w-5xl mx-auto px-6 lg:px-10">

        {/* ── Breadcrumb ───────────────────────────────────────────────────── */}
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-gray-500 pt-5 pb-4 min-w-0">
          <Link href="/" className="hover:text-gray-900 transition-colors shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
            Home
          </Link>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-gray-300" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-gray-900 font-medium truncate min-w-0">{guide.title}</span>
        </nav>

        {/* ── Hero image ───────────────────────────────────────────────────── */}
        {guide.hero_image_url && (
          <div className="relative h-[220px] md:h-[340px] rounded-2xl overflow-hidden bg-gray-100 shadow-sm mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={guide.hero_image_url}
              alt={guide.title}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* ── Title + context ──────────────────────────────────────────────── */}
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight leading-tight mb-3">
          {guide.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 mb-8">
          <span className="font-medium text-gray-700">{locationLabel}</span>
          {guide.publish_at && (
            <>
              <span aria-hidden="true" className="text-gray-300">·</span>
              <span>Updated {formatDate(guide.publish_at)}</span>
            </>
          )}
        </div>

        {/* ── Intro ────────────────────────────────────────────────────────── */}
        {guide.intro && (
          <p className="text-lg text-gray-600 leading-relaxed mb-8">{guide.intro}</p>
        )}

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        {guide.body && (
          <div className="text-[15px] text-gray-700 leading-relaxed whitespace-pre-wrap mb-12">
            {guide.body}
          </div>
        )}

        {/* ── Attached venues / events ─────────────────────────────────────── */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-5 tracking-tight leading-snug">
            {isVenueGuide ? "Featured Venues" : "Featured Events"}
          </h2>
          {isVenueGuide ? (
            venueCards.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {venueCards.map((v) => (
                  <SearchResultCard key={v.venueUuid} data={v} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                No venues have been added to this guide yet.
              </p>
            )
          ) : eventItems.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {eventItems.map((e) => (
                <EventSearchCard key={e.id} event={e} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              No events have been added to this guide yet.
            </p>
          )}
        </section>

        {/* ── CTA back into discovery ──────────────────────────────────────── */}
        <div className="mb-12 p-6 rounded-2xl bg-amber-50 border border-amber-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="text-sm font-medium text-amber-900">
            {isVenueGuide
              ? `Explore every happy hour in ${guide.marketName}.`
              : `Explore every upcoming event in ${guide.marketName}.`}
          </p>
          <Link
            href={isVenueGuide ? "/website-happy-hours" : "/website-events"}
            className="shrink-0 inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
          >
            {isVenueGuide ? "Browse Venues" : "Browse Events"}
          </Link>
        </div>

        {/* ── More guides ──────────────────────────────────────────────────── */}
        {relatedGuides.length > 0 && (
          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4 tracking-tight leading-snug">
              More Guides in {guide.marketName}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {relatedGuides.map((g) => (
                <Link
                  key={g.slug}
                  href={`/${guide.marketSlug}/guides/${g.slug}`}
                  className="block group rounded-xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
                >
                  <div className="h-32 bg-gray-100 overflow-hidden">
                    {g.hero_image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={g.hero_image_url}
                        alt={g.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-semibold text-gray-900 line-clamp-2">{g.title}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
