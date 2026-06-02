import type { Metadata } from "next";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { WelcomeGate } from "./WelcomeGate";
import { ConsumerHome } from "./home/ConsumerHome";
import type { HomeEventItem } from "./home/EventRailCard";

export const metadata: Metadata = {
  title: { absolute: "Happy Hour Compass" },
};

export const dynamic = "force-dynamic";

// ─── Rail slice helpers ───────────────────────────────────────────────────────
// Each helper produces the server-side data slice for one rail.
// Adding a new rail: add a helper here + a new key in HomepageData + a
// <RailSection> block in ConsumerHome.tsx.

const RAIL_MAX = 12;
const NEARBY_POOL = 30; // pool passed to client for geo sorting
const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30-day window

// ─── Market config (V1 — Central Okanagan) ───────────────────────────────────
// Used to pre-filter the Featured Nearby pool so out-of-market venues
// (Vancouver, Seattle, Toronto, etc.) never appear in the rail or collection.
// Venues without coordinates are included permissively (likely in-market,
// just missing GPS data).

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

// ─────────────────────────────────────────────────────────────────────────────

export default async function ConsumerHomePage() {
  const venues = await getPublishedVenuesForConsumer();

  // ── Rail 1: Spotlight Venues (verified only) ──────────────────────────────
  const spotlightVenues = venues
    .filter((v) => v.isVerified)
    .slice(0, RAIL_MAX);

  // ── Rail 2: Patio Picks (seededTags OR searchTags includes "Patio") ───────
  const patioPicksVenues = venues
    .filter(
      (v) =>
        v.seededTags.includes("Patio") || v.searchTags.includes("Patio")
    )
    .slice(0, RAIL_MAX);

  // ── Rail 3: Featured Nearby — market-filtered pool; client geo-sorts after mount ───
  const nearbyVenues = venues
    .filter((v) => isNearMarket(v.latitude, v.longitude))
    .slice(0, NEARBY_POOL);

  // ── Rail 4: New This Week (within last 30 days, sorted newest first) ──────
  const cutoff = new Date(Date.now() - NEW_WINDOW_MS).toISOString();
  const newThisWeekVenues = [...venues]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((v) => v.createdAt >= cutoff)
    .slice(0, RAIL_MAX);

  // ── Rail 5: Featured Events — flatten venue.events[] with venue context ───
  const featuredEvents: HomeEventItem[] = venues
    .flatMap((v) =>
      v.events.map((e) => ({
        id: e.id,
        title: e.title,
        venueName: v.name,
        venueSlug: v.id,
        nextOccurrenceLabel: e.nextOccurrenceLabel,
      }))
    )
    .slice(0, RAIL_MAX);

  return (
    <main className="bg-gray-50">
      <WelcomeGate>
        <ConsumerHome
          spotlightVenues={spotlightVenues}
          patioPicksVenues={patioPicksVenues}
          nearbyVenues={nearbyVenues}
          newThisWeekVenues={newThisWeekVenues}
          featuredEvents={featuredEvents}
        />
      </WelcomeGate>
    </main>
  );
}
