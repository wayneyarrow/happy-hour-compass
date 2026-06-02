"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ConsumerVenue } from "@/lib/data/venues";
import { haversineKm } from "../VenueList";
import { RailSection } from "./RailSection";
import { VenueRailCard } from "./VenueRailCard";
import { EventRailCard, type HomeEventItem } from "./EventRailCard";
import { BrowseSection } from "./BrowseSection";
import type { BrowseCategory } from "./browseCategories";

const HOME_SCROLL_KEY = "hhc_home_scroll";

// ─────────────────────────────────────────────────────────────────────────────

const NEARBY_COUNT = 8;

function computeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ─── Market config (V1 — hardcoded Central Okanagan) ─────────────────────────
// Future: replace with MarketConfig object selected by homepage configuration.

const MARKET_LABEL = "Central Okanagan";

// ─── Homepage configuration (V1) ─────────────────────────────────────────────
// Rail Library architecture: each rail is declared as a RailConfig entry with
//   id, title, subtitle, viewAllHref, and a data slice.
// The page server-component pre-filters each slice; ConsumerHome just renders.
//
// Rail Library (defined in page.tsx server-component):
//   "spotlight"  — isVerified venues, max 12
//   "patio"      — seededTags ∪ searchTags includes "Patio", max 12
//   "nearby"     — all venues, client-side geo sort → nearest NEARBY_COUNT
//   "new"        — sorted by createdAt DESC, within last 30 days, max 12
//   "events"     — upcoming events flattened from venue.events[], max 12
//
// Adding a new rail in a future phase:
//   1. Add a slice in page.tsx
//   2. Add a prop to HomepageData below
//   3. Add a <RailSection> block in ConsumerHome

export type HomepageData = {
  spotlightVenues: ConsumerVenue[];
  patioPicksVenues: ConsumerVenue[];
  nearbyVenues: ConsumerVenue[];   // full pool; geo-sorted client-side
  newThisWeekVenues: ConsumerVenue[];
  featuredEvents: HomeEventItem[];
  // Browse sections — pre-filtered server-side to ≥ BROWSE_MIN_LOCAL local venues.
  // Empty arrays hide the section from the homepage entirely.
  browseExperienceCategories: BrowseCategory[];
  browseFoodCategories: BrowseCategory[];
  browseDrinksCategories: BrowseCategory[];
};

// ─────────────────────────────────────────────────────────────────────────────

export function ConsumerHome({
  spotlightVenues,
  patioPicksVenues,
  nearbyVenues,
  newThisWeekVenues,
  featuredEvents,
  browseExperienceCategories = [],
  browseFoodCategories = [],
  browseDrinksCategories = [],
}: HomepageData) {
  // Time-based greeting — safe to derive synchronously in a client component
  // (ConsumerHome is only mounted after WelcomeGate reaches phase "done", so
  // there is no SSR render of this tree to mismatch against)
  const [greeting] = useState(computeGreeting);

  // "Featured Nearby" rail — starts with server slice, geo-sorted after mount
  const [sortedNearby, setSortedNearby] = useState<ConsumerVenue[]>(
    () => nearbyVenues.slice(0, NEARBY_COUNT)
  );

  useEffect(() => {
    if (!navigator.geolocation || nearbyVenues.length === 0) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude: uLat, longitude: uLng } = coords;
        const withDist = nearbyVenues
          .filter((v) => v.latitude !== null && v.longitude !== null)
          .map((v) => ({
            v,
            d: haversineKm(uLat, uLng, v.latitude!, v.longitude!),
          }))
          .sort((a, b) => a.d - b.d)
          .slice(0, NEARBY_COUNT)
          .map(({ v }) => v);
        // Only replace if we got enough usable results
        if (withDist.length >= 3) setSortedNearby(withDist);
      },
      () => {}, // permission denied — keep server slice
      { timeout: 5000, maximumAge: 60_000 }
    );
  }, [nearbyVenues]);

  // Restore scroll position when back-navigating from a collection view.
  // Position is saved to sessionStorage by saveScroll (called from each rail's
  // onViewAll). Same rAF retry loop pattern as VenueDiscovery.tsx.
  useEffect(() => {
    const saved = sessionStorage.getItem(HOME_SCROLL_KEY);
    if (!saved) return;
    const top = parseInt(saved, 10);
    if (!top) {
      sessionStorage.removeItem(HOME_SCROLL_KEY);
      return;
    }
    const el = document.getElementById("consumer-scroll");
    if (!el) return;

    let rafId: number;
    let attempts = 0;
    const MAX_ATTEMPTS = 20;

    function tryRestore() {
      el!.scrollTop = top;
      if (el!.scrollTop >= top - 1 || attempts >= MAX_ATTEMPTS) {
        sessionStorage.removeItem(HOME_SCROLL_KEY);
        return;
      }
      attempts++;
      rafId = requestAnimationFrame(tryRestore);
    }

    rafId = requestAnimationFrame(tryRestore);
    return () => cancelAnimationFrame(rafId);
  }, []);

  function saveScroll() {
    const el = document.getElementById("consumer-scroll");
    if (el) sessionStorage.setItem(HOME_SCROLL_KEY, String(el.scrollTop));
  }

  return (
    <>
      {/* Global: hide scrollbar on rail tracks */}
      <style>{`.hhc-rail::-webkit-scrollbar { display: none; }`}</style>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "22px 20px 18px",
          background: "white",
          borderBottom: "1px solid #f3f4f6",
        }}
      >
        {/* Greeting */}
        <p
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: "#111827",
            marginBottom: 5,
            letterSpacing: "-0.3px",
            lineHeight: 1.2,
          }}
        >
          {greeting} 👋
        </p>

        {/* Location chip */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            marginBottom: 16,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#9ca3af"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 13, height: 13, flexShrink: 0 }}
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>
            {MARKET_LABEL}
          </span>
        </div>

        {/* Search CTA — tappable placeholder that navigates to /explore */}
        <Link href="/explore" style={{ display: "block", textDecoration: "none" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: "11px 14px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9ca3af"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: 16, height: 16, flexShrink: 0 }}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <span style={{ fontSize: 15, color: "#9ca3af" }}>Search venues…</span>
          </div>
        </Link>
      </div>

      {/* ── Rails ───────────────────────────────────────────────────────────── */}
      <div style={{ paddingTop: 24, paddingBottom: 110 }}>

        {/* Rail 1 — Spotlight Venues (isVerified) */}
        {spotlightVenues.length > 0 && (
          <RailSection
            title="🌟 Spotlight Venues"
            viewAllHref="/home/collections/spotlight"
            onViewAll={saveScroll}
          >
            {spotlightVenues.map((v) => (
              <VenueRailCard key={v.id} venue={v} />
            ))}
          </RailSection>
        )}

        {/* Rail 2 — Patio Picks (seededTags or searchTags contains "Patio") */}
        {patioPicksVenues.length > 0 && (
          <RailSection
            title="☀️ Patio Picks"
            viewAllHref="/home/collections/patio-picks"
            onViewAll={saveScroll}
          >
            {patioPicksVenues.map((v) => (
              <VenueRailCard key={v.id} venue={v} />
            ))}
          </RailSection>
        )}

        {/* Rail 3 — Featured Nearby (geo-sorted client-side) */}
        {sortedNearby.length > 0 && (
          <RailSection
            title="📍 Featured Nearby"
            viewAllHref="/home/collections/featured-nearby"
            onViewAll={saveScroll}
          >
            {sortedNearby.map((v) => (
              <VenueRailCard key={v.id} venue={v} />
            ))}
          </RailSection>
        )}

        {/* Rail 4 — New This Week (recently added venues) */}
        {newThisWeekVenues.length > 0 && (
          <RailSection
            title="✨ New This Week"
            viewAllHref="/home/collections/new-this-week"
            onViewAll={saveScroll}
          >
            {newThisWeekVenues.map((v) => (
              <VenueRailCard key={v.id} venue={v} />
            ))}
          </RailSection>
        )}

        {/* Rail 5 — Featured Events */}
        {featuredEvents.length > 0 && (
          <RailSection
            title="🎉 Featured Events"
            viewAllHref="/home/collections/featured-events"
            viewAllLabel="All events"
            onViewAll={saveScroll}
          >
            {featuredEvents.map((e) => (
              <EventRailCard key={e.id} event={e} />
            ))}
          </RailSection>
        )}

        {/* ── Browse sections ──────────────────────────────────────────────── */}
        {(browseExperienceCategories.length > 0 ||
          browseFoodCategories.length > 0 ||
          browseDrinksCategories.length > 0) && (
          <div
            style={{
              margin: "4px 20px 28px",
              borderTop: "1px solid #f3f4f6",
            }}
          />
        )}

        {/* Browse by Experience — hidden if < BROWSE_MIN_LOCAL local venues */}
        {browseExperienceCategories.length > 0 && (
          <BrowseSection
            title="Browse by Experience"
            categories={browseExperienceCategories}
            seeAllHref="/home/browse/experience"
            onNav={saveScroll}
          />
        )}

        {/* Browse by Food */}
        {browseFoodCategories.length > 0 && (
          <BrowseSection
            title="Browse by Food"
            categories={browseFoodCategories}
            seeAllHref="/home/browse/food"
            onNav={saveScroll}
          />
        )}

        {/* Browse by Drinks */}
        {browseDrinksCategories.length > 0 && (
          <BrowseSection
            title="Browse by Drinks"
            categories={browseDrinksCategories}
            seeAllHref="/home/browse/drinks"
            onNav={saveScroll}
          />
        )}

        {/* Browse all — bottom CTA when rails alone don't cover all venues */}
        <div style={{ padding: "4px 20px 0" }}>
          <Link
            href="/explore"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "white",
              border: "1.5px solid #e5e7eb",
              borderRadius: 12,
              padding: "13px 20px",
              fontSize: 14,
              fontWeight: 600,
              color: "#374151",
              textDecoration: "none",
              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
            }}
          >
            Browse all venues →
          </Link>
        </div>
      </div>
    </>
  );
}
