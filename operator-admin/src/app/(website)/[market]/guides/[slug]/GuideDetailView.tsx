import Link from "next/link";
import type { PublicGuideDetail, RelatedGuideSummary } from "@/lib/data/contentGuides";
import type { SearchResultCardData } from "@/app/(website)/website-happy-hours/SearchResultCard";
import { SearchResultCard } from "@/app/(website)/website-happy-hours/SearchResultCard";
import { EventSearchCard } from "@/app/(website)/website-events/EventSearchCard";
import type { WebsiteEventListItem } from "@/lib/data/events";
import { GuideCard } from "@/app/(website)/GuideCard";

/**
 * Guide Experience V2 Card 2A — the guide-detail presentation, extracted
 * from this route's page.tsx so it can be reused by the Control Panel's
 * admin-safe preview route (content-engine/[id]/preview) without the two
 * surfaces drifting apart. Both call sites pass the same PublicGuideDetail
 * shape (the preview route reads it via getGuideForPreview instead of
 * getPublicGuideByMarketAndSlug, bypassing the published/in-window gate —
 * see contentGuides.ts).
 *
 * Scope note (Card 2A): this still renders the legacy `body` field verbatim,
 * exactly as before extraction — it does NOT yet render the new
 * editorial_section_1/2/3 fields (see getEditorialSections in
 * contentGuides.ts). Wiring the new premium editorial layout (hero, standfirst,
 * structured sections — docs/website/design-reference/guide-layout-v2-reference.png)
 * into this component is Card 2B's job; this card only had to make sure the
 * data is ready to consume and that preview doesn't drift from public
 * rendering. So today, preview and public both show the old body-based
 * layout identically — which is the correct, non-drifting behavior until
 * Card 2B redesigns this component.
 */

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

type Props = {
  guide: PublicGuideDetail;
  isVenueGuide: boolean;
  venueCards: SearchResultCardData[];
  eventItems: WebsiteEventListItem[];
  relatedGuides: RelatedGuideSummary[];
};

export function GuideDetailView({
  guide,
  isVenueGuide,
  venueCards,
  eventItems,
  relatedGuides,
}: Props) {
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
                <GuideCard
                  key={g.slug}
                  title={g.title}
                  href={`/${guide.marketSlug}/guides/${g.slug}`}
                  heroImageUrl={g.hero_image_url}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
