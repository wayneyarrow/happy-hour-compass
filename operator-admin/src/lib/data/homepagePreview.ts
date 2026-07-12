/**
 * Homepage Preview data loader (Task 5 — Build Homepage Preview).
 *
 * Answers "what would this Homepage actually render right now?" for the
 * Control Panel preview route. Draft-inclusive for the Homepage itself
 * (mirrors getGuideForPreview's "no gate" pattern in contentGuides.ts) —
 * but every piece of assigned content is still checked against its OWN
 * public eligibility (published venue/event, published+in-window guide,
 * published+non-archived Collection), per
 * docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md's "an assigned
 * Collection with no eligible members does not render publicly" and this
 * task's "the content inside the preview should still respect each item's
 * own public eligibility."
 *
 * Reuses, rather than duplicates:
 *   - getHomepageById (homepages.ts) — draft-inclusive Homepage + ordered Sections.
 *   - getCollectionById + resolveCollectionPreview (collections.ts /
 *     collectionsPreview.ts) — the SAME resolver the Collections editor uses
 *     (algorithm, manual overrides, boosts, item limits, ordering). Nothing
 *     about Collection resolution is reimplemented here.
 *   - getPublishedVenuesByUuids / getPublishedEventsByIds / getSavedGuideCardsByIds
 *     — the existing public-safe card loaders (venues.ts, events.ts,
 *     contentGuides.ts) — the same "does this id still resolve as public
 *     content right now" check already used by the Guide preview route and
 *     the public Guide/Venue/Event pages.
 *
 * Geography: no second layer of picker-style filtering happens here. A
 * Section's Collection or Feature content was already geography-validated
 * against this Homepage at assignment time (homepages.ts); this loader only
 * re-checks CURRENT eligibility (published/in-window), not geography.
 */

import { getHomepageById } from "@/lib/data/homepages";
import type { HomepageSection, HomepageStatus } from "@/lib/data/homepagesShared";
import { getCollectionById } from "@/lib/data/collections";
import { resolveCollectionPreview } from "@/lib/data/collectionsPreview";
import { getPublishedVenuesByUuids, type ConsumerVenue } from "@/lib/data/venues";
import { getPublishedEventsByIds, type WebsiteEventListItem } from "@/lib/data/events";
import { getSavedGuideCardsByIds, type SavedGuideCard } from "@/lib/data/contentGuides";
import { computeHhStatus } from "@/lib/happyHourStatus";
import { getAllMarkets, getCitiesWithVenues, getDefaultCityForMarket } from "@/lib/geo/geography";
import { getMarketById as getStaticMarketBySlug, type Market } from "@/lib/markets";
import type { CityRecord } from "@/lib/geo/types";
import type { SearchResultCardData } from "@/app/(website)/website-happy-hours/SearchResultCard";

// ── Card image fallback ──────────────────────────────────────────────────────
// Same convention already duplicated across the public venue pages, the
// Saved-venues-full API route, and the Guide preview route (see those
// files' identical fallbackImage()) — matched here rather than invented.

function fallbackVenueImage(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar") || t.includes("brewery") || t.includes("pub")) return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

function venueToSearchResultCard(v: ConsumerVenue, marketSlug: string): SearchResultCardData {
  return {
    id: v.id,
    venueUuid: v.venueUuid,
    href: `/${marketSlug}/venue/${v.id}`,
    name: v.name,
    image: fallbackVenueImage(v.establishmentType),
    isVerified: v.isVerified,
    googleRating: v.googleRating,
    hhStatus: computeHhStatus(v.happyHourWeekly),
    distanceKm: null,
    establishmentType: v.establishmentType,
    foodSpecial: v.specialsFood[0] ?? undefined,
    drinkSpecial: v.specialsDrinks[0] ?? undefined,
  };
}

// ── Rendering-ready shapes ───────────────────────────────────────────────────

/** Guide Collection rail item — just enough for GuideCard ((website)/GuideCard.tsx). */
export type HomepagePreviewGuideCard = {
  id: string;
  title: string;
  href: string;
  heroImageUrl: string | null;
};

function guideToRailCard(g: SavedGuideCard): HomepagePreviewGuideCard {
  return { id: g.id, title: g.title, href: `/${g.marketSlug}/guides/${g.slug}`, heroImageUrl: g.heroImageUrl };
}

export type HomepagePreviewFeatureCard = {
  eyebrow: "Featured Venue" | "Featured Event" | "Featured Guide";
  title: string;
  /** Location or content-type context line — e.g. city, or venue name + city. */
  secondaryLabel: string | null;
  imageUrl: string | null;
  /** Null when the content has no Teaser authored — the renderer must collapse, never fabricate fallback copy. */
  teaser: string | null;
  ctaLabel: "View Venue" | "View Event" | "Read Guide";
  ctaHref: string;
};

export type HomepagePreviewSection =
  | { id: string; kind: "venue_collection"; title: string; viewAllHref: string; items: SearchResultCardData[] }
  | { id: string; kind: "event_collection"; title: string; viewAllHref: string; items: WebsiteEventListItem[] }
  | { id: string; kind: "guide_collection"; title: string; viewAllHref: string; items: HomepagePreviewGuideCard[] }
  | { id: string; kind: "venue_feature" | "event_feature" | "guide_feature"; title: string; feature: HomepagePreviewFeatureCard };

export type HomepagePreviewData = {
  id: string;
  name: string;
  status: HomepageStatus;
  marketName: string;
  marketSlug: string;
  cityName: string | null;
  pageTitle: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  canonicalUrl: string | null;
  updatedAt: string;
  /** Everything the Discovery Shell (header + hero) needs, resolved from the Homepage's OWN geography — never the previewing editor's browser location. */
  discoveryShell: {
    market: Market;
    /** City label for the header/hero — this Homepage's own city, or the market's default city when this is a Market Homepage. */
    cityName: string;
    cities: CityRecord[];
  };
  /** Already filtered to sections that resolved to at least one usable item, in saved display order. */
  sections: HomepagePreviewSection[];
};

// ── Section resolution ───────────────────────────────────────────────────────

const VIEW_ALL_HREF = {
  venue: "/website-happy-hours",
  event: "/website-events",
} as const;

async function resolveCollectionSection(section: HomepageSection, marketSlug: string): Promise<HomepagePreviewSection | null> {
  if (!section.collectionId || !section.collection) return null;
  // Defensive re-check against the Collection's CURRENT status — an assigned
  // Collection can be unpublished/archived after assignment (see homepages.ts
  // "getMerchandisableGuides"-style comment); a non-published Collection has
  // zero eligible members, same as an empty resolve.
  if (section.collection.status !== "published") return null;

  const collection = await getCollectionById(section.collectionId);
  if (!collection || collection.archivedAt) return null;

  const preview = await resolveCollectionPreview({
    collectionType: collection.collectionType,
    marketId: collection.marketId,
    cityId: collection.cityId,
    algorithmKey: collection.algorithmKey,
    itemLimit: collection.itemLimit,
    venueOverrides: collection.venueOverrides,
    eventOverrides: collection.eventOverrides,
    guideItems: collection.guideItems,
  });
  const orderedIds = preview.items.map((i) => i.id);
  if (orderedIds.length === 0) return null;

  if (section.sectionType === "venue") {
    const venues = await getPublishedVenuesByUuids(orderedIds);
    const byUuid = new Map(venues.map((v) => [v.venueUuid, v]));
    const items = orderedIds
      .map((id) => byUuid.get(id))
      .filter((v): v is ConsumerVenue => Boolean(v))
      .map((v) => venueToSearchResultCard(v, marketSlug));
    if (items.length === 0) return null;
    return { id: section.id, kind: "venue_collection", title: section.title, viewAllHref: VIEW_ALL_HREF.venue, items };
  }

  if (section.sectionType === "event") {
    const events = await getPublishedEventsByIds(orderedIds);
    const byId = new Map(events.map((e) => [e.id, e]));
    const items = orderedIds.map((id) => byId.get(id)).filter((e): e is WebsiteEventListItem => Boolean(e));
    if (items.length === 0) return null;
    return { id: section.id, kind: "event_collection", title: section.title, viewAllHref: VIEW_ALL_HREF.event, items };
  }

  // guide
  const guides = await getSavedGuideCardsByIds(orderedIds);
  const byId = new Map(guides.map((g) => [g.id, g]));
  const items = orderedIds.map((id) => byId.get(id)).filter((g): g is SavedGuideCard => Boolean(g)).map(guideToRailCard);
  if (items.length === 0) return null;
  return { id: section.id, kind: "guide_collection", title: section.title, viewAllHref: `/${marketSlug}/guides`, items };
}

async function resolveFeatureSection(section: HomepageSection, marketSlug: string): Promise<HomepagePreviewSection | null> {
  if (section.sectionType === "venue") {
    if (!section.venueId) return null;
    const [venue] = await getPublishedVenuesByUuids([section.venueId]);
    if (!venue) return null;
    return {
      id: section.id,
      kind: "venue_feature",
      title: section.title,
      feature: {
        eyebrow: "Featured Venue",
        title: venue.name,
        secondaryLabel: venue.city || null,
        imageUrl: venue.images[0]?.url ?? fallbackVenueImage(venue.establishmentType),
        teaser: venue.teaser,
        ctaLabel: "View Venue",
        ctaHref: `/${marketSlug}/venue/${venue.id}`,
      },
    };
  }

  if (section.sectionType === "event") {
    if (!section.eventId) return null;
    const [event] = await getPublishedEventsByIds([section.eventId]);
    if (!event) return null;
    return {
      id: section.id,
      kind: "event_feature",
      title: section.title,
      feature: {
        eyebrow: "Featured Event",
        title: event.title,
        secondaryLabel: event.venueName ? `${event.venueName}${event.nextOccurrenceLabel ? ` · ${event.nextOccurrenceLabel}` : ""}` : null,
        imageUrl: event.imageUrl,
        teaser: event.teaser,
        ctaLabel: "View Event",
        ctaHref: `/website-events/${event.id}`,
      },
    };
  }

  // guide
  if (!section.guideId) return null;
  const [guide] = await getSavedGuideCardsByIds([section.guideId]);
  if (!guide) return null;
  return {
    id: section.id,
    kind: "guide_feature",
    title: section.title,
    feature: {
      eyebrow: "Featured Guide",
      title: guide.title,
      secondaryLabel: guide.locationLabel || null,
      imageUrl: guide.heroImageUrl,
      teaser: guide.teaser,
      ctaLabel: "Read Guide",
      ctaHref: `/${guide.marketSlug}/guides/${guide.slug}`,
    },
  };
}

async function resolveSection(section: HomepageSection, marketSlug: string): Promise<HomepagePreviewSection | null> {
  if (!section.isEnabled) return null;
  return section.contentMode === "collection"
    ? resolveCollectionSection(section, marketSlug)
    : resolveFeatureSection(section, marketSlug);
}

// ── Discovery Shell geography ────────────────────────────────────────────────

async function resolveDiscoveryShellGeography(
  marketId: string,
  cityId: string | null,
  cityName: string | null
): Promise<{ market: Market; marketSlug: string; cityName: string; cities: CityRecord[] }> {
  const allMarkets = await getAllMarkets();
  const marketRecord = allMarkets.find((m) => m.id === marketId) ?? null;
  const marketSlug = marketRecord?.slug ?? "";

  const [cities, defaultCity] = await Promise.all([
    marketRecord ? getCitiesWithVenues(marketRecord.id) : Promise.resolve([]),
    !cityId && marketRecord ? getDefaultCityForMarket(marketRecord.id) : Promise.resolve(null),
  ]);

  const resolvedCityName = cityName ?? defaultCity?.name ?? marketRecord?.name ?? "";

  // Static Market config (src/lib/markets.ts) keyed by the same slug as the DB
  // markets table — see (website)/layout.tsx's "market.id == slug" comment.
  // Falls back to a minimal stand-in only if a market is somehow missing from
  // the static config (shouldn't happen for a real, active market) — the
  // Discovery Shell components only read market.id/market.name for display,
  // never lat/lng, in the preview (see HeroSection's isPersisted=true guard).
  const staticMarket: Market =
    getStaticMarketBySlug(marketSlug) ?? {
      id: marketSlug,
      name: marketRecord?.name ?? "",
      status: "active",
      center: { lat: 0, lng: 0 },
      radiusKm: 0,
      mapCenter: { lat: 0, lng: 0 },
      mapZoom: 12,
    };

  return { market: staticMarket, marketSlug, cityName: resolvedCityName, cities };
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Draft-inclusive Homepage preview loader — looks up by id (not a public
 * geography route), so it works identically for Draft/Published and
 * Market/City Homepages alike. Returns null only when the Homepage id itself
 * doesn't resolve (the preview route's notFound() trigger); every other
 * ineligibility (an empty Collection, an unpublished Feature target) is
 * absorbed into `sections` simply omitting that entry.
 */
export async function getHomepagePreviewData(homepageId: string): Promise<HomepagePreviewData | null> {
  const homepage = await getHomepageById(homepageId);
  if (!homepage) return null;

  const geo = await resolveDiscoveryShellGeography(homepage.marketId, homepage.cityId, homepage.cityName);

  const resolvedSections = await Promise.all(
    homepage.sections.map((section) => resolveSection(section, geo.marketSlug))
  );
  const sections = resolvedSections.filter((s): s is HomepagePreviewSection => s !== null);

  return {
    id: homepage.id,
    name: homepage.name,
    status: homepage.status,
    marketName: homepage.marketName,
    marketSlug: geo.marketSlug,
    cityName: homepage.cityName,
    pageTitle: homepage.pageTitle,
    metaTitle: homepage.metaTitle,
    metaDescription: homepage.metaDescription,
    ogTitle: homepage.ogTitle,
    ogDescription: homepage.ogDescription,
    canonicalUrl: homepage.canonicalUrl,
    updatedAt: homepage.updatedAt,
    discoveryShell: {
      market: geo.market,
      cityName: geo.cityName,
      cities: geo.cities,
    },
    sections,
  };
}
