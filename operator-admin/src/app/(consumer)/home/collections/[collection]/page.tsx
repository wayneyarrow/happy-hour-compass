import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ConsumerVenue } from "@/lib/data/venues";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { getPublishedEventsForConsumer } from "@/lib/data/events";
import {
  getSpotlightVenues,
  getPatioPicks,
  getFeaturedNearby,
  getNewThisWeek,
  getTaggedVenues,
} from "@/lib/discover/discoverEngine";
import { CollectionVenueView } from "./CollectionVenueView";
import { CollectionEventView } from "./CollectionEventView";

export const dynamic = "force-dynamic";

// ─── Collection registry ──────────────────────────────────────────────────────
// tag: when set, delegates filtering to getTaggedVenues() (market-capped).
// Curated collections (spotlight, patio-picks, etc.) use named engine functions.

type CollectionSlug =
  | "spotlight"
  | "patio-picks"
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

  // ── Events collection ───────────────────────────────────────────────────────
  if (meta.type === "event") {
    const events = await getPublishedEventsForConsumer();
    return (
      <main className="bg-gray-50 min-h-full">
        <CollectionEventView title={meta.title} events={events} />
      </main>
    );
  }

  // ── Venue collections ───────────────────────────────────────────────────────
  // Collections show the full filtered set (no RAIL_MAX slice).
  // All filtering/sorting delegated to the Discover Engine.
  const venues = await getPublishedVenuesForConsumer();

  let filtered: ConsumerVenue[];

  if (meta.tag) {
    // Tag-based browse collections — market-capped via getTaggedVenues.
    filtered = getTaggedVenues(venues, meta.tag);
  } else {
    switch (collection as CollectionSlug) {
      case "spotlight":
        filtered = getSpotlightVenues(venues);
        break;
      case "patio-picks":
        filtered = getPatioPicks(venues);
        break;
      case "featured-nearby":
        // VenueList geo-sorts client-side after mount.
        filtered = getFeaturedNearby(venues);
        break;
      case "new-this-week":
        filtered = getNewThisWeek(venues);
        break;
      default:
        filtered = venues;
    }
  }

  return (
    <main className="bg-gray-50 min-h-full">
      <CollectionVenueView title={meta.title} venues={filtered} />
    </main>
  );
}
