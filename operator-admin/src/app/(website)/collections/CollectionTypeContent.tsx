import Link from "next/link";
import { CollectionBreadcrumb } from "./CollectionBreadcrumb";
import { formatCollectionItemCount, type PublicCollectionModel } from "@/lib/data/collectionPublic";
import type { ConsumerVenue } from "@/lib/data/venues";
import { computeHhStatus } from "@/lib/happyHourStatus";
import { getMarketById } from "@/lib/markets";
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
 * Guide Collection rendering remains out of scope for this task — that
 * branch still renders nothing.
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

function venueToWebsiteVenueCard(v: ConsumerVenue, marketSlug: string): WebsiteVenueCard {
  return {
    id: v.id,
    venueUuid: v.venueUuid,
    href: `/${marketSlug}/venue/${v.id}`,
    name: v.name,
    image: v.images[0]?.url ?? fallbackVenueImage(v.establishmentType),
    isVerified: v.isVerified,
    googleRating: v.googleRating,
    hhStatus: computeHhStatus(v.happyHourWeekly),
    distanceKm: null,
    establishmentType: v.establishmentType,
    foodSpecial: v.specialsFood[0] ?? undefined,
    drinkSpecial: v.specialsDrinks[0] ?? undefined,
    latitude: v.latitude,
    longitude: v.longitude,
    happyHourWeekly: v.happyHourWeekly,
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

  const cards = model.items.map((venue) => venueToWebsiteVenueCard(venue, model.marketSlug));

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

function GuideCollectionContent({ model }: { model: Extract<PublicCollectionModel, { kind: "guide" }> }) {
  // Guide editorial layout — future task. `model.items` is already
  // public-safe SavedGuideCard[] in final resolved order, ready to consume.
  void model;
  return null;
}
