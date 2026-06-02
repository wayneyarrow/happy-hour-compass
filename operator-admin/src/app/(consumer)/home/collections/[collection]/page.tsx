import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { getPublishedEventsForConsumer } from "@/lib/data/events";
import { CollectionVenueView } from "./CollectionVenueView";
import { CollectionEventView } from "./CollectionEventView";

export const dynamic = "force-dynamic";

// ─── Market config (V1 — Central Okanagan) ───────────────────────────────────
// Mirrors the filter in the home page rail so Featured Nearby collection
// stays local. Venues without coordinates are included permissively.

const MARKET_LAT = 49.888;   // Kelowna, BC
const MARKET_LNG = -119.496;
const NEARBY_RADIUS_KM = 50;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isNearMarket(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return true;
  return haversineKm(MARKET_LAT, MARKET_LNG, lat, lng) <= NEARBY_RADIUS_KM;
}

// ─── Collection registry ──────────────────────────────────────────────────────

type CollectionSlug =
  | "spotlight"
  | "patio-picks"
  | "featured-nearby"
  | "new-this-week"
  | "featured-events";

const COLLECTIONS: Record<
  CollectionSlug,
  { title: string; type: "venue" | "event" }
> = {
  spotlight:         { title: "Spotlight Venues", type: "venue" },
  "patio-picks":     { title: "Patio Picks",      type: "venue" },
  "featured-nearby": { title: "Featured Nearby",  type: "venue" },
  "new-this-week":   { title: "New This Week",    type: "venue" },
  "featured-events": { title: "Featured Events",  type: "event" },
};

const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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
  // Each filter mirrors the exact logic used in the home page rail (page.tsx),
  // but without the RAIL_MAX slice so the collection shows the full set.
  const venues = await getPublishedVenuesForConsumer();

  let filtered;
  switch (collection as CollectionSlug) {
    case "spotlight":
      filtered = venues.filter((v) => v.isVerified);
      break;

    case "patio-picks":
      filtered = venues.filter(
        (v) =>
          v.seededTags.includes("Patio") || v.searchTags.includes("Patio")
      );
      break;

    case "featured-nearby":
      // Market-filtered pool; VenueList geo-sorts client-side automatically.
      filtered = venues.filter((v) => isNearMarket(v.latitude, v.longitude));
      break;

    case "new-this-week": {
      const cutoff = new Date(Date.now() - NEW_WINDOW_MS).toISOString();
      filtered = [...venues]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((v) => v.createdAt >= cutoff);
      break;
    }

    default:
      filtered = venues;
  }

  return (
    <main className="bg-gray-50 min-h-full">
      <CollectionVenueView title={meta.title} venues={filtered} />
    </main>
  );
}
