import type { Metadata } from "next";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { getCPFeaturedEventCandidates } from "@/lib/data/events";
import {
  getRailOverridesForKey,
  RAIL_KEYS,
  RAIL_LABELS,
  type RailKey,
} from "@/lib/data/discoverOverrides";
import { getEventOverridesForRail } from "@/lib/data/discoverEventOverrides";
import {
  getRailVenuesByKey,
  isNearMarket,
  isDiscoverEligible,
  type RailOverride,
} from "@/lib/discover/discoverEngine";
import { computeFeaturedEventRail } from "@/lib/discover/featuredEventsEngine";
import { RailTabs } from "./RailTabs";
import { DiscoverVenueRow } from "./DiscoverVenueRow";
import { DiscoverEventRow } from "./DiscoverEventRow";
import { AddVenuePanel } from "./AddVenuePanel";
import { AddEventPanel } from "./AddEventPanel";
import { RemovedVenueRow } from "./RemovedVenueRow";
import { RemovedEventRow } from "./RemovedEventRow";

export const metadata: Metadata = { title: "Discover Management" };
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────

type Props = { searchParams: Promise<Record<string, string>> };

export default async function DiscoverPage({ searchParams }: Props) {
  const { rail: rawRail } = await searchParams;
  const rail: RailKey = RAIL_KEYS.includes(rawRail as RailKey)
    ? (rawRail as RailKey)
    : "spotlight";

  const isFeaturedEvents = rail === "featured-events";

  // ── Data fetching ──────────────────────────────────────────────────────────
  // For Featured Events: fetch event candidates + event-level overrides.
  // For venue rails: fetch consumer venues + venue-level overrides.
  const [venues, venueOverrides, allEventCandidates, eventOverrides] =
    await Promise.all([
      getPublishedVenuesForConsumer(),
      getRailOverridesForKey(rail),
      getCPFeaturedEventCandidates(),
      getEventOverridesForRail("featured-events"),
    ]);

  // ── Canonical Featured Events result ──────────────────────────────────────
  // Computed once; used for the tab badge and (when on this tab) the CP display.
  // When viewing another rail, venueOverrides belongs to that rail, not
  // featured-events — pass [] in that case (same trade-off accepted by venue
  // rail badges that also skip per-rail overrides for non-active tabs).
  const canonicalFeaturedEvents = computeFeaturedEventRail(
    allEventCandidates,
    eventOverrides,
    isFeaturedEvents ? venueOverrides : []
  );

  // ── Rail counts for tab badges ─────────────────────────────────────────────
  const counts = Object.fromEntries(
    RAIL_KEYS.map((key) => {
      if (key === "featured-events") {
        return [key, canonicalFeaturedEvents.length];
      }
      return [key, getRailVenuesByKey(key, venues).length];
    })
  ) as Record<RailKey, number>;

  // ══════════════════════════════════════════════════════════════════════════
  // FEATURED EVENTS rail — event-level management
  // ══════════════════════════════════════════════════════════════════════════

  if (isFeaturedEvents) {
    // Use the canonical result already computed above (same pipeline as consumer).
    const railEvents = canonicalFeaturedEvents;

    // Lookup sets for CP-only display concerns (source badge, removed section, add panel).
    const nixedEventUuids = new Set(
      eventOverrides.filter((o) => o.action === "exclude").map((o) => o.eventUuid)
    );
    const includedEventUuids = new Set(
      eventOverrides.filter((o) => o.action === "include").map((o) => o.eventUuid)
    );

    // Removed events (individually nixed via event-level override)
    const removedEventMap = new Map(
      eventOverrides
        .filter((o) => o.action === "exclude")
        .map((o) => [o.eventUuid, o])
    );
    const removedEvents = allEventCandidates.filter((e) =>
      removedEventMap.has(e.eventUuid)
    );

    // Add candidates: events not in the canonical rail and not individually nixed
    const inRailUuids = new Set(railEvents.map((e) => e.eventUuid));
    const addCandidates = allEventCandidates.filter(
      (e) => !inRailUuids.has(e.eventUuid) && !nixedEventUuids.has(e.eventUuid)
    );

    const totalInRail = railEvents.length;

    return (
      <div className="max-w-4xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Discover Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage what appears on the Consumer Home discovery rails. Internal curation
            works alongside the algorithm — geography and publish status always apply.
          </p>
        </div>

        {/* Rail tabs */}
        <RailTabs currentRail={rail} counts={counts} />

        {/* Rail header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">
              {RAIL_LABELS[rail]}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {totalInRail} event{totalInRail !== 1 ? "s" : ""} currently in this rail
            </p>
          </div>
        </div>

        {/* Helper text */}
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
          Published, discover-eligible upcoming events appear automatically. Use{" "}
          <strong>Internal Boost</strong> to lift a specific event higher in the rail,{" "}
          <strong>Nix</strong> to remove an individual event without affecting other events
          from the same venue, <strong>Restore</strong> to bring a nixed event back, and{" "}
          <strong>Exclude from Discover</strong> to permanently hide an event from all
          discovery rails. Past events and events from globally-excluded venues are
          never shown.
        </div>

        {/* Add event — placed before the table for discoverability */}
        <AddEventPanel candidates={addCandidates} railKey={rail} />

        {/* In-rail event list */}
        <div className="bg-white rounded-xl border border-gray-200 mt-4 mb-4">
          {/* Column headers */}
          <div className="hidden sm:flex items-center gap-x-4 px-4 py-2 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
            <span className="flex-1 min-w-0">Event</span>
            <span className="shrink-0 w-28">Venue</span>
            <span className="shrink-0 w-16 text-center">Plan</span>
            <span className="shrink-0 w-20 text-center">Source</span>
            <span className="shrink-0 w-16 text-center">Boost</span>
            <span className="shrink-0 w-24 text-center leading-tight">
              Exclude<br /><span className="normal-case text-[10px] tracking-normal">from discover</span>
            </span>
            <span className="shrink-0 w-20"></span>
          </div>

          {/* Event rows */}
          {railEvents.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">
              No upcoming events found for this rail.
            </p>
          ) : (
            railEvents.map((e) => (
              <DiscoverEventRow
                key={e.eventUuid}
                event={e}
                railKey={rail}
                source={includedEventUuids.has(e.eventUuid) ? "override" : "algorithm"}
              />
            ))
          )}
        </div>

        {/* Removed events (individually nixed) */}
        {removedEvents.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-medium text-gray-500 hover:text-gray-700 select-none">
              Removed from this rail ({removedEvents.length})
            </summary>
            <div className="mt-2 bg-white rounded-xl border border-red-100">
              {removedEvents.map((e) => {
                const override = removedEventMap.get(e.eventUuid);
                return (
                  <RemovedEventRow
                    key={e.eventUuid}
                    event={e}
                    railKey={rail}
                    reasonType={override?.reasonType ?? null}
                    note={override?.note ?? null}
                    removedBy={override?.updatedBy ?? override?.createdBy ?? null}
                  />
                );
              })}
            </div>
          </details>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VENUE RAILS — unchanged logic
  // ══════════════════════════════════════════════════════════════════════════

  // Build override lookup sets
  const overrideBrief: RailOverride[] = venueOverrides.map((o) => ({
    venueUuid: o.venueUuid,
    action: o.action,
  }));
  const includeUuids = new Set(
    venueOverrides.filter((o) => o.action === "include").map((o) => o.venueUuid)
  );
  const excludeUuids = new Set(
    venueOverrides.filter((o) => o.action === "exclude").map((o) => o.venueUuid)
  );

  const railVenues = getRailVenuesByKey(rail, venues, overrideBrief);
  const railUuids  = new Set(railVenues.map((v) => v.venueUuid));

  // Removed venues (active exclude override for this rail)
  const removedVenueMap = new Map(
    venueOverrides.filter((o) => o.action === "exclude").map((o) => [o.venueUuid, o])
  );
  const removedVenues = venues.filter((v) => removedVenueMap.has(v.venueUuid));

  // Add candidates
  const addCandidates = venues.filter(
    (v) =>
      isNearMarket(v.latitude, v.longitude) &&
      isDiscoverEligible(v) &&
      !railUuids.has(v.venueUuid) &&
      !excludeUuids.has(v.venueUuid)
  );

  const totalInRail = railVenues.length;

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Discover Management</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage what appears on the Consumer Home discovery rails. Internal curation
          works alongside the algorithm — geography and publish status always apply.
        </p>
      </div>

      {/* Rail tabs */}
      <RailTabs currentRail={rail} counts={counts} />

      {/* Rail header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            {RAIL_LABELS[rail]}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {totalInRail} venue{totalInRail !== 1 ? "s" : ""} currently in this rail
          </p>
        </div>
      </div>

      {/* Add venue */}
      <AddVenuePanel candidates={addCandidates} railKey={rail} />

      {/* In-rail venue list */}
      <div className="bg-white rounded-xl border border-gray-200 mt-4 mb-4">
        {/* Column headers */}
        <div className="hidden sm:flex items-center gap-x-4 px-4 py-2 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
          <span className="flex-1 min-w-0">Venue</span>
          <span className="shrink-0 w-16 text-center">Plan</span>
          <span className="shrink-0 w-20 text-center">Source</span>
          <span className="shrink-0 w-16 text-center">Boost</span>
          <span className="shrink-0 w-24 text-center leading-tight">
            Exclude<br /><span className="normal-case text-[10px] tracking-normal">from discover</span>
          </span>
          <span className="shrink-0 w-20"></span>
        </div>

        {/* Venue rows */}
        {railVenues.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">
            No venues in this rail yet.
          </p>
        ) : (
          railVenues.map((v) => (
            <DiscoverVenueRow
              key={v.venueUuid}
              venue={v}
              railKey={rail}
              source={includeUuids.has(v.venueUuid) ? "override" : "algorithm"}
            />
          ))
        )}
      </div>

      {/* Removed from rail */}
      {removedVenues.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-gray-500 hover:text-gray-700 select-none">
            Removed from this rail ({removedVenues.length})
          </summary>
          <div className="mt-2 bg-white rounded-xl border border-red-100">
            {removedVenues.map((v) => {
              const override = removedVenueMap.get(v.venueUuid);
              return (
                <RemovedVenueRow
                  key={v.venueUuid}
                  venue={v}
                  railKey={rail}
                  reasonType={override?.reasonType ?? null}
                  note={override?.note ?? null}
                  removedBy={override?.updatedBy ?? override?.createdBy ?? null}
                />
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
