import Link from "next/link";
import { getEditorialSections, type PublicGuideDetail, type RelatedGuideSummary } from "@/lib/data/contentGuides";
import type { SearchResultCardData } from "@/app/(website)/website-happy-hours/SearchResultCard";
import { SearchResultCard } from "@/app/(website)/website-happy-hours/SearchResultCard";
import { EventSearchCard } from "@/app/(website)/website-events/EventSearchCard";
import type { WebsiteEventListItem } from "@/lib/data/events";
import { GuideCard } from "@/app/(website)/GuideCard";

/**
 * Guide Experience V2 — the guide-detail presentation, extracted (Card 2A)
 * from this route's page.tsx so it can be reused by the Control Panel's
 * admin-safe preview route (content-engine/[id]/preview) without the two
 * surfaces drifting apart. Both call sites pass the same PublicGuideDetail
 * shape (the preview route reads it via getGuideForPreview instead of
 * getPublicGuideByMarketAndSlug, bypassing the published/in-window gate —
 * see contentGuides.ts).
 *
 * Card 2B final polish: matches the approved magazine reference
 * (docs/website/design-reference/guide-layout-v2-reference.png) —
 * full-width hero across the top, then an editorial spread below it: left
 * column is location/kicker/title (the "cover" block), right column is
 * standfirst followed by the editorial sections. This is NOT a side-by-side
 * hero/title layout — the hero is a separate full-width band above the
 * two-column spread, never one of its columns.
 *
 * On mobile the grid collapses to one column; because the left column
 * (location, kicker, title) and right column (standfirst, sections) are
 * already in that DOM order, mobile stacking falls out for free — hero →
 * location → title → standfirst → sections — with no CSS `order` tricks and
 * no duplicated markup.
 *
 * Legacy `body` fallback: a guide only renders its editorial sections when
 * at least one exists. Guides created before Card 2A (or not yet migrated
 * off the old single Body field) have no editorial sections yet, so their
 * legacy `body` content is rendered in its place — otherwise those guides
 * would silently lose their visible content the moment this redesign
 * shipped. Once a guide has any editorial section content, `body` is no
 * longer considered (editorial sections fully replace it for that guide).
 *
 * No client interactivity here — plain server-rendered markup, so this
 * component costs zero extra JavaScript.
 */

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const LOCATION_PIN_PATH =
  "M12 21s-6.75-6.35-6.75-11A6.75 6.75 0 1118.75 10c0 4.65-6.75 11-6.75 11z";

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
  const kicker = isVenueGuide ? "Venue Guide" : "Event Guide";

  const editorialSections = getEditorialSections(guide);
  const hasEditorialContent = editorialSections.length > 0;

  return (
    <div className="bg-white pb-16">
      {/* ── Breadcrumb ─────────────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-6 lg:px-10">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-gray-500 pt-5 pb-4 min-w-0">
          <Link href="/" className="hover:text-gray-900 transition-colors shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
            Home
          </Link>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-gray-300" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-gray-900 font-medium truncate min-w-0">{guide.title}</span>
        </nav>
      </div>

      {/* ── Hero image — full width across the top, shorter than a marketing hero ── */}
      {guide.hero_image_url && (
        <div className="relative w-full h-[240px] sm:h-[320px] md:h-[400px] overflow-hidden bg-gray-100 mb-10 md:mb-14">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={guide.hero_image_url}
            alt={guide.title}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 lg:px-10">
        {/* ── Editorial spread: left = cover block, right = standfirst + sections ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
          {/* Left column — location, kicker, title */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-hidden="true">
                <path d={LOCATION_PIN_PATH} />
              </svg>
              <span className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500">
                {locationLabel}
              </span>
            </div>

            <p className="text-sm text-gray-400 mb-2">{kicker}</p>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 tracking-tight leading-[1.05]">
              {guide.title}
            </h1>

            {guide.publish_at && (
              <p className="mt-4 text-sm text-gray-400">Updated {formatDate(guide.publish_at)}</p>
            )}
          </div>

          {/* Right column — standfirst, then editorial sections (falls back to legacy body) */}
          <div>
            {guide.intro && (
              <p className="pl-5 border-l-[3px] border-amber-400 text-xl md:text-2xl font-medium text-gray-800 leading-relaxed">
                {guide.intro}
              </p>
            )}

            {hasEditorialContent ? (
              <div className={`space-y-8 md:space-y-10 ${guide.intro ? "mt-8 md:mt-10" : ""}`}>
                {editorialSections.map((section, i) => (
                  <div key={i}>
                    {section.heading && (
                      <h2 className="text-xl font-bold text-gray-900 tracking-tight leading-snug mb-3">
                        {section.heading}
                      </h2>
                    )}
                    <p className="text-[16px] text-gray-700 leading-[1.8] whitespace-pre-wrap">
                      {section.body}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              guide.body && (
                <div className={`text-[16px] text-gray-700 leading-[1.8] whitespace-pre-wrap ${guide.intro ? "mt-8 md:mt-10" : ""}`}>
                  {guide.body}
                </div>
              )
            )}
          </div>
        </div>

        {/* ── Featured venues / events ─────────────────────────────────────── */}
        <section className="mt-14 md:mt-16 pt-10 md:pt-12 border-t border-gray-100 mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight leading-snug">
            {isVenueGuide ? "Featured Happy Hours" : "Featured Events"}
          </h2>
          <p className="mt-2 text-sm text-gray-500 max-w-xl">
            {isVenueGuide
              ? "Hand-picked spots from this guide, worth the trip."
              : "Don't miss these upcoming happenings."}
          </p>
          <div className="mt-6">
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
          </div>
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
