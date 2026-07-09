import Image from "next/image";
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
 * Card 2B final layout polish: contained (not edge-to-edge) hero image,
 * then a two-column opening — left column is location/title/updated date,
 * right column is the standfirst only — followed by full-width editorial
 * sections below both columns, then the unchanged featured cards/CTA/
 * related guides.
 *
 * Alignment: location, title, and updated date are three separate grid
 * children explicitly placed at lg:row-start-1/2/3 in column 1; the
 * standfirst is placed at lg:row-start-2 in column 2. Because CSS Grid row
 * gaps are shared across every column in that row, the standfirst always
 * starts exactly where row 2 begins — i.e. level with the title, never
 * with the location — without any hardcoded pixel offsets. The generous
 * gap the task asks for between location and title is a margin on the
 * location element itself, which (being in row 1) pushes row 2's start
 * down for both columns uniformly. On mobile (`grid-cols-1`, no lg:
 * placement) the same four children simply fall back to DOM order:
 * location → title → date → standfirst, which is exactly the required
 * mobile stack.
 *
 * Location text: "{City}, {Province}" — province is NOT part of
 * PublicGuideDetail (the guide query only selects market slug/name; adding
 * province would be a data-layer change, out of scope for this card), so
 * it's resolved from a small local lookup keyed by the already-available
 * guide.marketName. See MARKET_PROVINCE below. Falls back to just the
 * city/market name if the market isn't in the lookup, rather than
 * guessing or showing "Canada".
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

// Presentation-only province abbreviation, derived from the known markets
// in src/lib/markets.ts — NOT sourced from the guide query (see module
// docstring). Extend this if a new market is added.
const MARKET_PROVINCE: Record<string, string> = {
  "Central Okanagan": "BC",
  "Greater Vancouver": "BC",
  "Victoria": "BC",
  "Calgary": "AB",
};

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
  const cityOrMarket = guide.cityName || guide.marketName;
  const province = MARKET_PROVINCE[guide.marketName];
  const locationLabel = province ? `${cityOrMarket}, ${province}` : cityOrMarket;

  const editorialSections = getEditorialSections(guide);
  const hasEditorialContent = editorialSections.length > 0;

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

        {/* ── Hero image — contained, editorial but not oversized ─────────────── */}
        {guide.hero_image_url && (
          <div className="relative w-full h-[220px] sm:h-[280px] md:h-[340px] rounded-2xl overflow-hidden bg-gray-100 mb-10 md:mb-14">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={guide.hero_image_url}
              alt={guide.title}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* ── Two-column opening: location/title/date (left) + standfirst (right) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 lg:gap-x-16 gap-y-3">
          <div className="lg:col-start-1 lg:row-start-1 mb-8 lg:mb-10 flex items-center gap-2">
            <Image
              src="/hhc-icon.png"
              alt=""
              width={271}
              height={345}
              aria-hidden="true"
              className="h-4 w-auto shrink-0"
            />
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-gray-500">
              {locationLabel}
            </span>
          </div>

          <h1 className="lg:col-start-1 lg:row-start-2 text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 tracking-tight leading-[1.05]">
            {guide.title}
          </h1>

          {guide.publish_at && (
            <p className="lg:col-start-1 lg:row-start-3 text-sm text-gray-400">
              Updated {formatDate(guide.publish_at)}
            </p>
          )}

          {guide.intro && (
            <p className="lg:col-start-2 lg:row-start-2 pl-5 border-l-[3px] border-amber-400 text-xl md:text-2xl font-medium text-gray-800 leading-relaxed">
              {guide.intro}
            </p>
          )}
        </div>

        {/* ── Editorial sections — full width, below both columns (falls back to legacy body) ── */}
        {hasEditorialContent ? (
          <div className="mt-14 md:mt-16 space-y-8 md:space-y-10 max-w-3xl">
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
            <div className="mt-14 md:mt-16 text-[16px] text-gray-700 leading-[1.8] whitespace-pre-wrap max-w-3xl">
              {guide.body}
            </div>
          )
        )}

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
