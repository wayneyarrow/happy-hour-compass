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

  // ── Rail 3: Featured Nearby — pass a pool; client geo-sorts after mount ───
  const nearbyVenues = venues.slice(0, NEARBY_POOL);

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
