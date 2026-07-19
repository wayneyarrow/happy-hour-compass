import Link from "next/link";
import { CollectionBreadcrumb } from "./CollectionBreadcrumb";
import { formatCollectionItemCount, type PublicCollectionModel } from "@/lib/data/collectionPublic";
import type { ConsumerVenue } from "@/lib/data/venues";
import type { SavedGuideCard } from "@/lib/data/contentGuides";
import { getMarketById } from "@/lib/markets";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import {
  HappyHoursSearchClient,
  type WebsiteVenueCard,
} from "@/app/(website)/website-happy-hours/HappyHoursSearchClient";
import { EventSearchResults } from "@/app/(website)/website-events/EventSearchResults";

/**
 * Type-specific Collection Landing Page content — the clean boundary
 * beneath the shared shell (CollectionLandingShell.tsx):
 *   - VenueCollectionContent  -> Venue results/map presentation
 *   - EventCollectionContent  -> Event results/map presentation
 *   - GuideCollectionContent  -> Guide editorial layout
 *
 * VenueCollectionContent and EventCollectionContent reuse the exact Happy
 * Hour / Event search-map experiences (HappyHoursSearchClient /
 * EventSearchResults) rather than building new browsing UI — the `cards` /
 * `events` each renderer passes in are constrained to `model.items`, which
 * is already the resolved, ordered Collection membership from
 * getPublicCollectionModel / resolveCollectionPreview. Filters and
 * alternate sorts only ever reorder or narrow that fixed set; they can
 * never introduce items outside it.
 *
 * The shared shell (CollectionLandingShell) renders no hero for Venue or
 * Event Collections — CollectionSearchContextHeader below renders the
 * breadcrumb, title, Public Intro, and curated count *through* each search
 * client's own contextHeader slot instead, so it appears only in the left
 * results column, in the exact position the unrestricted pages' generic
 * heading/count normally occupies, never above the filter bar.
 *
 * GuideCollectionContent takes the opposite approach by design (Guide
 * Collections product decision — see HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md
 * and the Guide Collection renderer task): it does not reuse a search
 * experience at all. It is a magazine-style editorial reading page — a Lead
 * Guide feature (the first resolved Collection item) followed by a "Keep
 * exploring" grid of the rest, both built from `model.items`
 * (SavedGuideCard[]) in resolved Collection order, with zero search/filter/
 * sort/map UI. The Collection's internal Description is never read — only
 * `publicIntro`, exactly like the other two renderers.
 */

type Props = {
  model: PublicCollectionModel;
};

export function CollectionTypeContent({ model }: Props) {
  switch (model.kind) {
    case "venue":
      return <VenueCollectionContent model={model} />;
    case "event":
      return <EventCollectionContent model={model} />;
    case "guide":
      return <GuideCollectionContent model={model} />;
  }
}

// ── Card image fallback ──────────────────────────────────────────────────────
// Same convention already duplicated across the public venue pages, the
// Saved-venues-full API route, and homepagesRendering.ts (see those files'
// identical fallbackImage()) — matched here rather than invented.

function fallbackVenueImage(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar") || t.includes("brewery") || t.includes("pub")) return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

// Returns null when the venue has no assigned market/city yet (see
// buildVenuePublicPath) — no canonical URL exists to link to.
function venueToWebsiteVenueCard(v: ConsumerVenue): WebsiteVenueCard | null {
  const href = buildVenuePublicPath({ marketSlug: v.marketSlug, citySlug: v.citySlug, slug: v.id });
  if (!href) return null;
  return {
    id: v.id,
    venueUuid: v.venueUuid,
    href,
    name: v.name,
    image: v.images[0]?.url ?? fallbackVenueImage(v.establishmentType),
    isVerified: v.isVerified,
    googleRating: v.googleRating,
    happyHourWeekly: v.happyHourWeekly,
    distanceKm: null,
    establishmentType: v.establishmentType,
    foodSpecial: v.specialsFood[0] ?? undefined,
    drinkSpecial: v.specialsDrinks[0] ?? undefined,
    latitude: v.latitude,
    longitude: v.longitude,
  };
}

/**
 * Replaces the default SearchContextHeader (the "Happy Hours" heading +
 * geography selector + count) inside HappyHoursSearchClient's contextHeader
 * slot. Mirrors that default's typographic scale (h1 text-2xl, muted count
 * line) so the results column reads as the same search page, just with
 * Collection editorial context standing in for the generic heading — no
 * separate hero, no second breadcrumb/title/intro/count elsewhere on the page.
 */
function CollectionSearchContextHeader({ model }: { model: PublicCollectionModel }) {
  return (
    <div>
      <CollectionBreadcrumb collectionName={model.name} compact />
      <h1 className="text-2xl font-bold text-gray-900 tracking-tight leading-tight">{model.name}</h1>
      {model.publicIntro && (
        <p className="mt-2 text-sm text-gray-600 leading-relaxed max-w-2xl">{model.publicIntro}</p>
      )}
      <p className="mt-3 text-xs text-gray-400">{formatCollectionItemCount(model)}</p>
    </div>
  );
}

/** Exits the Collection context into the given unrestricted search route. */
function ExploreAllCta({ href, label }: { href: string; label: string }) {
  return (
    <div className="px-4 md:px-6 py-10 border-t border-gray-100 text-center">
      <Link
        href={href}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
      >
        {label}
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </Link>
    </div>
  );
}

function VenueCollectionContent({ model }: { model: Extract<PublicCollectionModel, { kind: "venue" }> }) {
  // MARKETS[].id matches markets.slug 1:1 (see markets.ts) — model.marketSlug
  // already passed the DB market lookup in getPublicCollectionModel, so this
  // only comes back undefined if a market exists in the DB but hasn't been
  // added to the static MARKETS config yet.
  const market = getMarketById(model.marketSlug);
  if (!market) return null;

  const cards = model.items
    .map((venue) => venueToWebsiteVenueCard(venue))
    .filter((c): c is WebsiteVenueCard => c !== null);

  return (
    <HappyHoursSearchClient
      cards={cards}
      market={market}
      collectionOrder
      contextHeader={<CollectionSearchContextHeader model={model} />}
      footerCta={<ExploreAllCta href="/website-happy-hours" label="Explore all Happy Hours" />}
    />
  );
}

function EventCollectionContent({ model }: { model: Extract<PublicCollectionModel, { kind: "event" }> }) {
  // Same rationale as VenueCollectionContent above: model.marketSlug already
  // passed the DB market lookup in getPublicCollectionModel.
  const market = getMarketById(model.marketSlug);
  if (!market) return null;

  return (
    <EventSearchResults
      events={model.items}
      market={market}
      contextHeader={<CollectionSearchContextHeader model={model} />}
      footerCta={<ExploreAllCta href="/website-events" label="Explore all Events" />}
    />
  );
}

/**
 * Magazine-style feature treatment for the first resolved Collection guide.
 * Modeled on the Homepage's guide_feature Section (FeatureSection.tsx —
 * image one side, eyebrow/title/summary/CTA the other, in a bordered
 * rounded-3xl card) rather than the compact GuideCard used by the guides
 * library and "More Guides" — GuideCard's h-32 thumbnail + single title
 * line can't carry the lead position's required prominence, and per this
 * task's guidance an existing compact card should not be forced into a
 * hierarchy it can't support.
 *
 * Whole card is one Link (rather than a separate title link + button) so
 * mobile gets one obvious, generous tap target.
 */
function LeadGuideFeature({ guide, marketSlug }: { guide: SavedGuideCard; marketSlug: string }) {
  const summary = guide.standfirst ?? guide.teaser;

  return (
    <Link href={`/${marketSlug}/guides/${guide.slug}`} className="group block">
      {/* lg:grid-cols-[45fr_55fr] gives the editorial content column slightly
          greater weight than the image (~55/45), keeping this the page's
          focal point without the image dominating. shadow-sm is the same
          understated elevation used on the grid cards below — one shared,
          restrained "card" language for the whole page.

          Desktop height (lg:h-[375px], down from 440px) + the matching lg:
          trims below (lg:py-9, lg:mt-6, lg:line-clamp-3 on the summary) were
          sized by real Chromium/Playwright measurement, not estimation: at
          440px the content column's own natural height (~500px, driven by
          the unclamped summary) was already taller than the image, so
          shrinking the image alone did nothing — "Keep exploring" stayed
          fully below the fold at 1440x900 and 1512x982 regardless. 375px is
          the value where the image and the (now-clamped) content column's
          natural height land exactly together — a clean edge-to-edge image
          fill with no gap — while surfacing "Keep exploring" at both target
          viewports (10px visible at 1440x900, fully visible at 1512x982).
          All four new/changed classes are lg:-scoped so mobile (which never
          had a fold problem) renders byte-for-byte as before: full untruncated
          summary, mt-8 CTA spacing, h-[260px]/sm:h-[340px] image. */}
      <div className="grid grid-cols-1 lg:grid-cols-[45fr_55fr] items-stretch rounded-3xl overflow-hidden border border-gray-100 bg-gray-50 shadow-sm">
        <div className="relative h-[260px] sm:h-[340px] lg:h-[375px] bg-gray-100">
          {guide.heroImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={guide.heroImageUrl}
              alt={guide.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          )}
        </div>
        <div className="flex flex-col justify-center px-6 py-8 lg:px-12 lg:py-9">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-4">
            {guide.locationLabel}
          </p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 tracking-tight leading-[1.1] group-hover:text-amber-700 transition-colors">
            {guide.title}
          </h2>
          {summary && (
            <p className="mt-5 text-base md:text-lg text-gray-600 leading-relaxed max-w-md lg:line-clamp-3">{summary}</p>
          )}
          <span className="mt-8 lg:mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            Read the guide
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * "Keep exploring" grid card — richer than the compact GuideCard (taller
 * image, location eyebrow, summary snippet) to hold its own visually next
 * to the Lead Guide feature above it, while staying clearly secondary in
 * scale. Same summary source and fallback as the lead card, so a Collection
 * reads consistently guide-to-guide.
 */
function GuideGridCard({ guide, marketSlug }: { guide: SavedGuideCard; marketSlug: string }) {
  const summary = guide.standfirst ?? guide.teaser;

  return (
    <Link href={`/${marketSlug}/guides/${guide.slug}`} className="group block">
      {/* shadow-sm matches the Lead Guide feature's elevation — same restrained
          "card" language, applied to the image surface only so the layout and
          image proportions stay exactly as they were. */}
      <div className="relative h-[200px] sm:h-[220px] rounded-2xl overflow-hidden bg-gray-100 shadow-sm mb-4">
        {guide.heroImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={guide.heroImageUrl}
            alt={guide.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        )}
      </div>
      <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-widest mb-1.5">
        {guide.locationLabel}
      </p>
      <h3 className="text-xl font-bold text-gray-900 tracking-tight leading-snug group-hover:text-amber-700 transition-colors">
        {guide.title}
      </h3>
      {summary && (
        <p className="mt-1.5 text-sm text-gray-500 leading-relaxed line-clamp-2">{summary}</p>
      )}
    </Link>
  );
}

function GuideCollectionContent({ model }: { model: Extract<PublicCollectionModel, { kind: "guide" }> }) {
  // getPublicCollectionModel already guarantees items.length > 0 for a
  // resolved Guide Collection (a zero-item Collection resolves to null,
  // which 404s upstream) — so `lead` is never undefined here.
  const [lead, ...rest] = model.items;

  return (
    <>
      <div className="max-w-5xl mx-auto px-6 lg:px-10 pb-16 md:pb-20">
        <LeadGuideFeature guide={lead} marketSlug={model.marketSlug} />

        {rest.length > 0 && (
          // md:mt-16 (back to the pre-polish desktop baseline — confirmed via
          // real Chromium measurement to be the smallest-margin ceiling here:
          // the Lead Guide card's own bottom edge already sits at ~951px on a
          // 1440x900 viewport, past the fold before this margin is even
          // applied, so no non-overlapping margin value makes "Keep exploring"
          // peek in at ~900-1000px viewport heights without touching the
          // preserved Lead Guide card/hero — out of scope for this pass. This
          // value does fully surface the heading at more generous viewport
          // heights (e.g. 1920x1080). Mobile (mt-20) is unchanged.
          <section className="mt-20 md:mt-16">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight leading-snug mb-8 md:mb-10">
              Keep exploring
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-10 md:gap-x-10 md:gap-y-12">
              {rest.map((guide) => (
                <GuideGridCard key={guide.id} guide={guide} marketSlug={model.marketSlug} />
              ))}
            </div>
          </section>
        )}
      </div>

      <ExploreAllCta href={`/${model.marketSlug}/guides`} label="Explore all Guides" />
    </>
  );
}
