/**
 * Public Collection Landing Page data loader (Collection Landing Pages —
 * Shared Public Infrastructure task).
 *
 * Answers "what should the public Collection Landing Page at
 * /{market}/collections/{slug} actually render right now?" — the
 * published-only, geography-scoped counterpart to the Control Panel
 * editor's draft-inclusive getCollectionById. Returns one shared model
 * consumed by all three future page types (Venue, Event, Guide
 * presentation) — this task builds only that shared foundation, not any
 * type-specific rendering.
 *
 * Reuses, rather than recreates:
 *   - getPublishedCollectionBySlug (collections.ts) — published/non-archived
 *     geography lookup, scoped to (marketId, slug), never global.
 *   - resolveCollectionPreview (collectionsPreview.ts) — the SAME resolver
 *     the Control Panel editor and Homepage Sections use. Every override,
 *     boost, include/exclude, manual-add, and ordering decision happens
 *     there and only there; this loader never re-implements any of it.
 *   - getPublishedVenuesByUuids / getPublishedEventsByIds /
 *     getSavedGuideCardsByIds — the existing public-safe card loaders
 *     (venues.ts, events.ts, contentGuides.ts) that check "does this id
 *     still resolve as public content right now" — the same ones
 *     homepagesRendering.ts's resolveSection() already uses for Homepage
 *     Collection Sections.
 *
 * A published Collection that resolves to zero publicly valid items (every
 * resolved id has since been unpublished/deleted, or it was genuinely
 * empty) is treated as unavailable: this loader returns null, and the
 * route responds with the normal 404 — never a hard error, never a
 * "coming soon" page.
 *
 * Must only be imported from Server Components, Route Handlers, or Server
 * Actions (transitively reaches createAdminClient()).
 */

import { getMarketBySlug } from "@/lib/geo/geography";
import { getPublishedCollectionBySlug } from "@/lib/data/collections";
import { resolveCollectionPreview } from "@/lib/data/collectionsPreview";
import { getPublishedVenuesByUuids, type ConsumerVenue } from "@/lib/data/venues";
import { getPublishedEventsByIds, type WebsiteEventListItem } from "@/lib/data/events";
import { getSavedGuideCardsByIds, type SavedGuideCard } from "@/lib/data/contentGuides";

type PublicCollectionBase = {
  id: string;
  name: string;
  slug: string;
  marketId: string;
  marketName: string;
  marketSlug: string;
  cityId: string | null;
  cityName: string | null;
  /** Visitor-facing intro (never Internal Description — see collectionsShared.ts's publicIntro doc comment). Null means the future Landing Page intro area collapses; no fallback is ever generated here. */
  publicIntro: string | null;
  itemCount: number;
};

/**
 * The shared public Collection model every future type-specific renderer
 * consumes. `items` is already public-safe and in final resolved order —
 * exactly the same record shapes the rest of the public website already
 * renders (ConsumerVenue -> SearchResultCard, WebsiteEventListItem ->
 * EventSearchCard, SavedGuideCard -> GuideCard), so a future task can wire
 * results/map or editorial presentation directly against `items` without
 * re-fetching or re-shaping anything.
 */
export type PublicCollectionModel =
  | (PublicCollectionBase & { kind: "venue"; items: ConsumerVenue[] })
  | (PublicCollectionBase & { kind: "event"; items: WebsiteEventListItem[] })
  | (PublicCollectionBase & { kind: "guide"; items: SavedGuideCard[] });

/**
 * Resolves the public Collection Landing Page model for a Market slug +
 * Collection slug pair, or null when the page should 404 (unknown Market,
 * unknown/Draft/archived/geographically-mismatched Collection, or a
 * published Collection with zero publicly valid items right now).
 */
export async function getPublicCollectionModel(
  marketSlug: string,
  collectionSlug: string
): Promise<PublicCollectionModel | null> {
  const market = await getMarketBySlug(marketSlug);
  if (!market) return null;

  const collection = await getPublishedCollectionBySlug(market.id, collectionSlug);
  if (!collection) return null;

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

  const base: Omit<PublicCollectionBase, "itemCount"> = {
    id: collection.id,
    name: collection.name,
    slug: collection.slug,
    marketId: collection.marketId,
    marketName: collection.marketName,
    marketSlug: market.slug,
    cityId: collection.cityId,
    cityName: collection.cityName,
    publicIntro: collection.publicIntro,
  };

  if (collection.collectionType === "venue") {
    const venues = await getPublishedVenuesByUuids(orderedIds);
    const byUuid = new Map(venues.map((v) => [v.venueUuid, v]));
    const items = orderedIds.map((id) => byUuid.get(id)).filter((v): v is ConsumerVenue => Boolean(v));
    if (items.length === 0) return null;
    return { ...base, kind: "venue", items, itemCount: items.length };
  }

  if (collection.collectionType === "event") {
    const events = await getPublishedEventsByIds(orderedIds);
    const byId = new Map(events.map((e) => [e.id, e]));
    const items = orderedIds.map((id) => byId.get(id)).filter((e): e is WebsiteEventListItem => Boolean(e));
    if (items.length === 0) return null;
    return { ...base, kind: "event", items, itemCount: items.length };
  }

  // guide
  const guides = await getSavedGuideCardsByIds(orderedIds);
  const byId = new Map(guides.map((g) => [g.id, g]));
  const items = orderedIds.map((id) => byId.get(id)).filter((g): g is SavedGuideCard => Boolean(g));
  if (items.length === 0) return null;
  return { ...base, kind: "guide", items, itemCount: items.length };
}

const COLLECTION_TYPE_NOUN: Record<PublicCollectionModel["kind"], { singular: string; plural: string }> = {
  venue: { singular: "venue", plural: "venues" },
  event: { singular: "event", plural: "events" },
  guide: { singular: "guide", plural: "guides" },
};

/** "1 venue" / "12 venues" / "3 events" / "1 guide" — correct singular/plural noun for the resolved item count. */
export function formatCollectionItemCount(model: PublicCollectionModel): string {
  const noun = COLLECTION_TYPE_NOUN[model.kind];
  const word = model.itemCount === 1 ? noun.singular : noun.plural;
  return `${model.itemCount} ${word}`;
}

/**
 * Concise SEO description generated from Collection name, type, and
 * geography — used only when Public Intro is absent. Never reads
 * `description` (Internal Description) — that field is never exposed
 * publicly, by design (see collectionsShared.ts's description doc comment).
 */
export function generateCollectionFallbackDescription(model: PublicCollectionModel): string {
  const geography = model.cityName ?? model.marketName;
  const noun = COLLECTION_TYPE_NOUN[model.kind].plural;
  return `${model.name} — a curated collection of ${noun} in ${geography}, from Happy Hour Compass.`;
}
