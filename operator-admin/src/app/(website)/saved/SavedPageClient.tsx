"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getLocalSavedItems } from "@/lib/consumer/savedItems";
import { useConsumerId } from "@/app/(website)/ConsumerAuthProvider";
import { SaveGuideButton } from "@/app/(website)/SaveGuideButton";
import {
  HappyHoursSearchClient,
  type WebsiteVenueCard,
} from "@/app/(website)/website-happy-hours/HappyHoursSearchClient";
import { EventSearchResults } from "@/app/(website)/website-events/EventSearchResults";
import type { Market } from "@/lib/markets";
import type { WebsiteEventListItem } from "@/lib/data/events";
import type { SavedGuideCard } from "@/lib/data/contentGuides";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "venues" | "events" | "guides";

type Props = {
  market: Market;
};

// ─── SavedContextHeader ───────────────────────────────────────────────────────
// Injected into the search clients via contextHeader prop, replacing their
// default SearchContextHeader / EventSearchContextHeader.

function SavedContextHeader({
  tab,
  displayedCount,
  savedVenueCount,
  savedEventCount,
  savedGuideCount,
  onTabChange,
  consumerId,
}: {
  tab: Tab;
  displayedCount: number;
  savedVenueCount: number;
  savedEventCount: number;
  savedGuideCount: number;
  onTabChange: (t: Tab) => void;
  consumerId: string | null;
}) {
  const itemLabel =
    displayedCount === 1
      ? tab === "venues"
        ? "venue"
        : tab === "events"
        ? "event"
        : "guide"
      : tab === "venues"
      ? "venues"
      : tab === "events"
      ? "events"
      : "guides";

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 tracking-tight leading-tight">
        Saved
      </h1>

      {/* Tab toggle */}
      <div className="mt-3 flex gap-1 p-1 bg-gray-100 rounded-full w-fit">
        <button
          type="button"
          onClick={() => onTabChange("venues")}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
            tab === "venues"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Venues{savedVenueCount > 0 ? ` (${savedVenueCount})` : ""}
        </button>
        <button
          type="button"
          onClick={() => onTabChange("events")}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
            tab === "events"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Events{savedEventCount > 0 ? ` (${savedEventCount})` : ""}
        </button>
        <button
          type="button"
          onClick={() => onTabChange("guides")}
          className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
            tab === "guides"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Guides{savedGuideCount > 0 ? ` (${savedGuideCount})` : ""}
        </button>
      </div>

      {/* Count sub-line */}
      <p className="mt-2 text-xs text-gray-400">
        {displayedCount.toLocaleString()} {itemLabel}
      </p>

      {/* Sign-in nudge — subtle, non-blocking */}
      {!consumerId && (savedVenueCount > 0 || savedEventCount > 0 || savedGuideCount > 0) && (
        <p className="mt-2 text-xs text-gray-400">
          <Link href="/sign-in" className="text-amber-600 hover:underline font-medium">
            Sign in
          </Link>{" "}
          to sync saved places across devices.
        </p>
      )}
    </div>
  );
}

// ─── Empty states ─────────────────────────────────────────────────────────────

function VenuesEmptyState({ consumerId }: { consumerId: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-24 min-h-[40vh]">
      <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-5">
        <svg
          className="w-8 h-8 text-red-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
      </div>
      <p className="text-lg font-bold text-gray-900 mb-2">No saved venues yet</p>
      <p className="text-sm text-gray-500 max-w-xs leading-relaxed mb-6">
        Tap the heart on any venue to save it for later. Happy hours won&apos;t
        slip by.
      </p>
      <Link
        href="/website-happy-hours"
        className="inline-flex items-center px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-full transition-colors"
      >
        Explore Happy Hours
      </Link>
      {!consumerId && (
        <p className="mt-4 text-xs text-gray-400">
          <Link href="/sign-in" className="text-amber-600 hover:underline font-medium">
            Sign in
          </Link>{" "}
          to sync saved places across devices.
        </p>
      )}
    </div>
  );
}

function EventsEmptyState({ consumerId }: { consumerId: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-24 min-h-[40vh]">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-5">
        <svg
          className="w-8 h-8 text-amber-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
      <p className="text-lg font-bold text-gray-900 mb-2">No saved events yet</p>
      <p className="text-sm text-gray-500 max-w-xs leading-relaxed mb-6">
        Tap the heart on any event to save it. Find your next night out, then
        come back here.
      </p>
      <Link
        href="/website-events"
        className="inline-flex items-center px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-full transition-colors"
      >
        Explore Events
      </Link>
      {!consumerId && (
        <p className="mt-4 text-xs text-gray-400">
          <Link href="/sign-in" className="text-amber-600 hover:underline font-medium">
            Sign in
          </Link>{" "}
          to sync saved places across devices.
        </p>
      )}
    </div>
  );
}

function GuidesEmptyState({
  consumerId,
  marketSlug,
}: {
  consumerId: string | null;
  marketSlug: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-24 min-h-[40vh]">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center mx-auto mb-5">
        <svg
          className="w-8 h-8 text-amber-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"
          />
        </svg>
      </div>
      <p className="text-lg font-bold text-gray-900 mb-2">No saved guides yet</p>
      <p className="text-sm text-gray-500 max-w-xs leading-relaxed mb-6">
        Tap the heart on any guide to save it here for later reading.
      </p>
      <Link
        href={`/${marketSlug}/guides`}
        className="inline-flex items-center px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-full transition-colors"
      >
        Browse Guides
      </Link>
      {!consumerId && (
        <p className="mt-4 text-xs text-gray-400">
          <Link href="/sign-in" className="text-amber-600 hover:underline font-medium">
            Sign in
          </Link>{" "}
          to sync saved places across devices.
        </p>
      )}
    </div>
  );
}

function NothingSavedState({ consumerId }: { consumerId: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-24 min-h-[40vh]">
      <div className="w-20 h-20 rounded-3xl bg-red-50 flex items-center justify-center mx-auto mb-6">
        <svg
          className="w-10 h-10 text-red-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
      </div>
      <p className="text-xl font-bold text-gray-900 mb-2">Nothing saved yet</p>
      <p className="text-sm text-gray-500 max-w-sm leading-relaxed mb-7">
        Tap the heart on any venue or event to save it here for later. Your
        personal guide to the best happy hours.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <Link
          href="/website-happy-hours"
          className="inline-flex items-center px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-full transition-colors"
        >
          Explore Happy Hours
        </Link>
        <Link
          href="/website-events"
          className="inline-flex items-center px-5 py-2.5 border border-gray-200 text-gray-700 text-sm font-semibold rounded-full hover:bg-gray-50 transition-colors"
        >
          Browse Events
        </Link>
      </div>
      {!consumerId && (
        <p className="mt-6 text-xs text-gray-400">
          <Link href="/sign-in" className="text-amber-600 hover:underline font-medium">
            Sign in
          </Link>{" "}
          to sync saved places across devices.
        </p>
      )}
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Sticky filter bar placeholder */}
      <div className="sticky top-16 md:top-[72px] z-20 bg-white border-b border-gray-200 h-[56px]" />

      <div className="hidden md:flex">
        {/* Left column */}
        <div className="w-1/2 px-5 pt-8 pb-10 border-r border-gray-100">
          {/* Header placeholder */}
          <div className="mb-7 space-y-3">
            <div className="h-7 bg-gray-100 rounded-lg w-20" />
            <div className="h-9 bg-gray-100 rounded-full w-44" />
            <div className="h-3 bg-gray-100 rounded w-16" />
          </div>
          {/* Card grid placeholder */}
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl overflow-hidden bg-gray-50 border border-gray-100">
                <div className="h-[200px] bg-gray-100" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-gray-100 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Map placeholder */}
        <div className="w-1/2 p-4">
          <div className="rounded-2xl bg-gray-100 h-full min-h-[400px]" />
        </div>
      </div>

      {/* Mobile skeleton */}
      <div className="md:hidden px-4 pt-6 pb-5 space-y-3 border-b border-gray-100">
        <div className="h-7 bg-gray-100 rounded-lg w-20" />
        <div className="h-9 bg-gray-100 rounded-full w-44" />
      </div>
    </div>
  );
}

// ─── SavedPageClient ──────────────────────────────────────────────────────────

export function SavedPageClient({ market }: Props) {
  const consumerId = useConsumerId();

  // ── Saved ID sets — kept in sync with localStorage ──────────────────────────
  const [savedVenueIds, setSavedVenueIds] = useState<Set<string>>(() => new Set());
  const [savedEventIds, setSavedEventIds] = useState<Set<string>>(() => new Set());
  const [savedGuideIds, setSavedGuideIds] = useState<Set<string>>(() => new Set());

  function refreshSavedIds() {
    const store = getLocalSavedItems();
    setSavedVenueIds(new Set(store.savedVenues.map((v) => v.id)));
    setSavedEventIds(new Set(store.savedEvents.map((e) => e.id)));
    setSavedGuideIds(new Set(store.savedGuides.map((g) => g.id)));
  }

  useEffect(() => {
    refreshSavedIds();
    window.addEventListener("hhc:savedChanged", refreshSavedIds);
    return () => window.removeEventListener("hhc:savedChanged", refreshSavedIds);
  }, []);

  // ── Fetched full card data (loaded once on mount) ────────────────────────────
  const [allVenueCards, setAllVenueCards] = useState<WebsiteVenueCard[]>([]);
  const [allEventItems, setAllEventItems] = useState<WebsiteEventListItem[]>([]);
  const [allGuideCards, setAllGuideCards] = useState<SavedGuideCard[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "done">("idle");

  const fetchData = useCallback(async () => {
    setLoadState("loading");

    const store = getLocalSavedItems();
    const venueIds = store.savedVenues.map((v) => v.id);
    const eventIds = store.savedEvents.map((e) => e.id);
    const guideIds = store.savedGuides.map((g) => g.id);

    const [venueCards, eventItems, guideCards] = await Promise.all([
      venueIds.length > 0
        ? fetch("/api/consumer/saved-venues-full", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ venueIds, marketId: market.id }),
          })
            .then((r) => (r.ok ? (r.json() as Promise<WebsiteVenueCard[]>) : []))
            .catch(() => [] as WebsiteVenueCard[])
        : Promise.resolve([] as WebsiteVenueCard[]),

      eventIds.length > 0
        ? fetch("/api/consumer/saved-events-full", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventIds }),
          })
            .then((r) => (r.ok ? (r.json() as Promise<WebsiteEventListItem[]>) : []))
            .catch(() => [] as WebsiteEventListItem[])
        : Promise.resolve([] as WebsiteEventListItem[]),

      guideIds.length > 0
        ? fetch("/api/consumer/saved-guides", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guideIds }),
          })
            .then((r) => (r.ok ? (r.json() as Promise<SavedGuideCard[]>) : []))
            .catch(() => [] as SavedGuideCard[])
        : Promise.resolve([] as SavedGuideCard[]),
    ]);

    // Order by savedAt descending (most-recently-saved first) — the same
    // recency convention the Saved dropdown already uses. Venues/Events don't
    // do this in their tabs today (their "-full" card shapes don't carry
    // savedAt), so this doesn't change their behaviour; it's guide-only.
    const savedAtByGuideId = new Map(store.savedGuides.map((g) => [g.id, g.savedAt]));
    const orderedGuideCards = [...guideCards].sort((a, b) =>
      (savedAtByGuideId.get(b.id) ?? "").localeCompare(savedAtByGuideId.get(a.id) ?? "")
    );

    setAllVenueCards(venueCards);
    setAllEventItems(eventItems);
    setAllGuideCards(orderedGuideCards);
    setLoadState("done");
  }, [market.id]);

  useEffect(() => {
    if (loadState === "idle") fetchData();
  }, [loadState, fetchData]);

  // ── Active tab — default to venues unless empty and events/guides exist ─────
  const [activeTab, setActiveTab] = useState<Tab | null>(null);

  useEffect(() => {
    if (loadState !== "done" || activeTab !== null) return;
    const hasVenues = savedVenueIds.size > 0;
    const hasEvents = savedEventIds.size > 0;
    const hasGuides = savedGuideIds.size > 0;
    if (hasVenues) {
      setActiveTab("venues");
    } else if (hasEvents) {
      setActiveTab("events");
    } else if (hasGuides) {
      setActiveTab("guides");
    } else {
      setActiveTab("venues");
    }
  }, [loadState, activeTab, savedVenueIds.size, savedEventIds.size, savedGuideIds.size]);

  // ── Filtered datasets — unsave a card and it immediately disappears ──────────
  // Filter by venueUuid (the DB UUID, which is what savedItems.ts stores).
  const displayedVenueCards = allVenueCards.filter((c) =>
    savedVenueIds.has(c.venueUuid)
  );
  // Filter by event id (UUID).
  const displayedEventItems = allEventItems.filter((e) =>
    savedEventIds.has(e.id)
  );
  // Filter by guide id (UUID); a saved guide that has been unpublished/removed
  // is simply absent from allGuideCards (getSavedGuideCardsByIds already
  // drops it) and so silently disappears here too — no broken-card risk.
  const displayedGuideCards = allGuideCards.filter((g) => savedGuideIds.has(g.id));

  const venueCount = savedVenueIds.size;
  const eventCount = savedEventIds.size;
  const guideCount = savedGuideIds.size;
  const nothingSaved = venueCount === 0 && eventCount === 0 && guideCount === 0;

  if (loadState !== "done") {
    return <LoadingSkeleton />;
  }

  const currentTab = activeTab ?? "venues";

  // ── Build context header for the search clients ──────────────────────────────
  const header = (
    <SavedContextHeader
      tab={currentTab}
      displayedCount={
        currentTab === "venues"
          ? displayedVenueCards.length
          : currentTab === "events"
          ? displayedEventItems.length
          : displayedGuideCards.length
      }
      savedVenueCount={venueCount}
      savedEventCount={eventCount}
      savedGuideCount={guideCount}
      onTabChange={setActiveTab}
      consumerId={consumerId}
    />
  );

  // ── Nothing saved at all ─────────────────────────────────────────────────────
  if (nothingSaved) {
    return (
      <>
        {/* Still render filter-bar-height spacer so layout feels intentional */}
        <div className="sticky top-16 md:top-[72px] z-20 bg-white border-b border-gray-200">
          <div className="px-4 md:px-6 py-3">
            <div className="flex gap-1 p-1 bg-gray-100 rounded-full w-fit">
              <span className="px-4 py-1.5 rounded-full text-sm font-semibold bg-white text-gray-900 shadow-sm">
                Venues
              </span>
              <span className="px-4 py-1.5 rounded-full text-sm font-semibold text-gray-500">
                Events
              </span>
              <span className="px-4 py-1.5 rounded-full text-sm font-semibold text-gray-500">
                Guides
              </span>
            </div>
          </div>
        </div>
        <NothingSavedState consumerId={consumerId} />
      </>
    );
  }

  // ── Venues tab ───────────────────────────────────────────────────────────────
  if (currentTab === "venues") {
    if (displayedVenueCards.length === 0) {
      return (
        <>
          <div className="sticky top-16 md:top-[72px] z-20 bg-white border-b border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <div className="px-4 md:px-6 py-3">
              {header}
            </div>
          </div>
          <VenuesEmptyState consumerId={consumerId} />
        </>
      );
    }
    return (
      <HappyHoursSearchClient
        cards={displayedVenueCards}
        market={market}
        contextHeader={header}
      />
    );
  }

  // ── Events tab ───────────────────────────────────────────────────────────────
  if (currentTab === "events") {
    if (displayedEventItems.length === 0) {
      return (
        <>
          <div className="sticky top-16 md:top-[72px] z-20 bg-white border-b border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            <div className="px-4 md:px-6 py-3">
              {header}
            </div>
          </div>
          <EventsEmptyState consumerId={consumerId} />
        </>
      );
    }
    return (
      <EventSearchResults
        events={displayedEventItems}
        market={market}
        contextHeader={header}
      />
    );
  }

  // ── Guides tab — editorial card/list, no map, no venue/event filters ────────
  return (
    <>
      <div className="sticky top-16 md:top-[72px] z-20 bg-white border-b border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <div className="px-4 md:px-6 py-3">
          {header}
        </div>
      </div>
      {displayedGuideCards.length === 0 ? (
        <GuidesEmptyState consumerId={consumerId} marketSlug={market.id} />
      ) : (
        <SavedGuidesGrid guides={displayedGuideCards} />
      )}
    </>
  );
}

// ─── SavedGuidesGrid ──────────────────────────────────────────────────────────
// Editorial card list for the Guides tab — reuses GuideCard's visual language
// (rounded image-top card) but, per the task's "editorial card/list" ask,
// adds the location + standfirst + remove control a bare GuideCard doesn't
// carry. No map, no happy-hour/event filters, no sort controls — this is a
// simple grid, ordered by savedAt (most-recently-saved first), matching the
// Saved dropdown's ordering convention.

function SavedGuidesGrid({ guides }: { guides: SavedGuideCard[] }) {
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {guides.map((guide) => (
          <SavedGuideEditorialCard key={guide.id} guide={guide} />
        ))}
      </div>
    </div>
  );
}

function SavedGuideEditorialCard({ guide }: { guide: SavedGuideCard }) {
  return (
    // <article> (not the Link) is the outer element so the Remove button
    // below can be an interactive sibling of the Link rather than nested
    // inside it — a <button> inside an <a> is invalid HTML and inaccessible.
    // Same structural fix applied to GuideCard.tsx / SearchResultCard.tsx.
    <article className="group relative rounded-2xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow bg-white">
      <Link href={`/${guide.marketSlug}/guides/${guide.slug}`} className="block">
        <div className="h-40 sm:h-44 bg-gray-100 overflow-hidden">
          {guide.heroImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={guide.heroImageUrl}
              alt={guide.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            />
          )}
        </div>

        <div className="p-4">
          {guide.locationLabel && (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
              {guide.locationLabel}
            </p>
          )}
          <p className="text-base font-bold text-gray-900 leading-snug line-clamp-2">
            {guide.title}
          </p>
          {guide.standfirst && (
            <p className="mt-1.5 text-sm text-gray-500 leading-relaxed line-clamp-2">
              {guide.standfirst}
            </p>
          )}
        </div>
      </Link>

      {/* Remove button — top-right, frosted circle, matches other Save buttons */}
      <div
        className="absolute top-2.5 right-3"
        style={{
          background: "rgba(255,255,255,0.88)",
          borderRadius: "50%",
          backdropFilter: "blur(4px)",
        }}
      >
        <SaveGuideButton guideId={guide.id} variant="list" />
      </div>
    </article>
  );
}
