import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ConsumerVenue } from "@/lib/data/venues";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { getCPFeaturedEventCandidates } from "@/lib/data/events";
import { getAllRailOverrides } from "@/lib/data/discoverOverrides";
import { getEventOverridesForRail } from "@/lib/data/discoverEventOverrides";
import {
  getSpotlightVenues,
  getPatioPicks,
  getHighlyRated,
  getFeaturedNearby,
  getNewThisWeek,
  getTaggedVenues,
} from "@/lib/discover/discoverEngine";
import { computeFeaturedEventRail } from "@/lib/discover/featuredEventsEngine";
import { CollectionVenueView } from "./CollectionVenueView";
import { CollectionEventView } from "./CollectionEventView";

export const dynamic = "force-dynamic";

// ─── Collection registry ──────────────────────────────────────────────────────
// tag: when set, delegates filtering to getTaggedVenues() (market-capped).
// Curated collections (spotlight, patio-picks, etc.) use named engine functions.

type CollectionSlug =
  | "spotlight"
  | "patio-picks"
  | "highly-rated"
  | "featured-nearby"
  | "new-this-week"
  | "featured-events"
  // Browse by Experience
  | "patio"
  | "dog-friendly"
  | "trivia"
  | "live-music"
  | "sports-bar"
  // Browse by Food
  | "pizza"
  | "burgers"
  | "tacos"
  | "seafood"
  // Browse by Drinks
  | "craft-beer"
  | "cocktails"
  | "wine";

const COLLECTIONS: Record<
  CollectionSlug,
  { title: string; type: "venue" | "event"; tag?: string }
> = {
  // ── Curated rails ────────────────────────────────────────────────────────────
  spotlight:         { title: "Spotlight Venues", type: "venue" },
  "patio-picks":     { title: "Patio Picks",      type: "venue" },
  "highly-rated":    { title: "Highly Rated",     type: "venue" },
  "featured-nearby": { title: "Featured Nearby",  type: "venue" },
  "new-this-week":   { title: "New This Week",    type: "venue" },
  "featured-events": { title: "Featured Events",  type: "event" },

  // ── Browse by Experience ─────────────────────────────────────────────────────
  patio:          { title: "Patio",        type: "venue", tag: "Patio"          },
  "dog-friendly": { title: "Dog Friendly", type: "venue", tag: "Dog Friendly"   },
  trivia:         { title: "Trivia",       type: "venue", tag: "Trivia Nights"  },
  "live-music":   { title: "Live Music",   type: "venue", tag: "Live Music"     },
  "sports-bar":   { title: "Sports Bar",   type: "venue", tag: "Sports Viewing" },

  // ── Browse by Food ───────────────────────────────────────────────────────────
  pizza:   { title: "Pizza",   type: "venue", tag: "Pizza"   },
  burgers: { title: "Burgers", type: "venue", tag: "Burgers" },
  tacos:   { title: "Tacos",   type: "venue", tag: "Tacos"   },
  seafood: { title: "Seafood", type: "venue", tag: "Seafood" },

  // ── Browse by Drinks ─────────────────────────────────────────────────────────
  "craft-beer": { title: "Craft Beer", type: "venue", tag: "Craft Beer" },
  cocktails:    { title: "Cocktails",  type: "venue", tag: "Cocktails"  },
  wine:         { title: "Wine",       type: "venue", tag: "Wine"       },
};

// ─────────────────────────────────────────────────────────────────────────────

type Props = { params: Promise<{ collection: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { collection } = await params;
  const meta = COLLECTIONS[collection as CollectionSlug];
  return { title: meta?.title ?? "Collection" };
}

export default async function CollectionPage({ params }: Props) {
  const { collection } = await params;
  const meta = COLLECTIONS[collection as CollectionSlug];
  if (!meta) notFound();

  // ── Events collection — fast path ──────────────────────────────────────────
  // Fetch event-specific data only when showing the Featured Events collection,
  // avoiding the full venue load for this case.
  if (meta.type === "event") {
    const [allOverrides, eventCandidates, eventOverrides] = await Promise.all([
      getAllRailOverrides(),
      getCPFeaturedEventCandidates(),
      getEventOverridesForRail("featured-events"),
    ]);
    // computeFeaturedEventRail applies all event-level controls and matches the
    // homepage Featured Events rail (same source of truth).
    const engineEvents = computeFeaturedEventRail(
      eventCandidates,
      eventOverrides,
      allOverrides["featured-events"]
    );
    // Map CPFeaturedEventItem → ConsumerEventListItem shape expected by EventCard.
    const events = engineEvents.map((e) => ({
      id:                  e.eventUuid,
      title:               e.title,
      venueName:           e.venueName,
      nextOccurrenceLabel: e.nextOccurrenceLabel,
      description:         null,
      imageUrl:            null,
      venueId:             e.venueSlug,
      firstDate:           e.firstDate,
      recurrence:          e.recurrence,
    }));
    return (
      <main className="bg-gray-50 min-h-full">
        <CollectionEventView title={meta.title} events={events} />
      </main>
    );
  }

  // Fetch venues + overrides for all venue collection types.
  const [venues, allOverrides] = await Promise.all([
    getPublishedVenuesForConsumer(),
    getAllRailOverrides(),
  ]);

  // ── Venue collections ───────────────────────────────────────────────────────
  // Collections show the full filtered set (no RAIL_MAX slice).
  // All filtering/sorting delegated to the Discover Engine — same functions and
  // overrides as the homepage rail, so See All always matches the rail source.
  let filtered: ConsumerVenue[];

  if (meta.tag) {
    // Tag-based browse collections — market-capped via getTaggedVenues.
    // Tag collections don't have rail-level overrides in V1.
    filtered = getTaggedVenues(venues, meta.tag);
  } else {
    switch (collection as CollectionSlug) {
      case "spotlight":
        filtered = getSpotlightVenues(venues, allOverrides["spotlight"]);
        break;
      case "patio-picks":
        filtered = getPatioPicks(venues, allOverrides["patio-picks"]);
        break;
      case "highly-rated":
        filtered = getHighlyRated(venues, allOverrides["highly-rated"]);
        break;
      case "featured-nearby":
        filtered = getFeaturedNearby(venues, allOverrides["featured-nearby"]);
        break;
      case "new-this-week":
        filtered = getNewThisWeek(venues, allOverrides["new-this-week"]);
        break;
      default:
        filtered = venues;
    }
  }

  // Only Featured Nearby geo-sorts (VenueList re-orders client-side by distance).
  // All other curated collections preserve the Discover Engine's scored ordering.
  const geoSort = collection === "featured-nearby";

  return (
    <main className="bg-gray-50 min-h-full">
      <CollectionVenueView title={meta.title} venues={filtered} geoSort={geoSort} />
    </main>
  );
}
