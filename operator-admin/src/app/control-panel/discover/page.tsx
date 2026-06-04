import type { Metadata } from "next";
import { getPublishedVenuesForConsumer } from "@/lib/data/venues";
import { getRailOverridesForKey, RAIL_KEYS, RAIL_LABELS, type RailKey } from "@/lib/data/discoverOverrides";
import {
  getRailVenuesByKey,
  getFeaturedEvents,
  isNearMarket,
  isDiscoverEligible,
  type RailOverride,
} from "@/lib/discover/discoverEngine";
import { RailTabs } from "./RailTabs";
import { DiscoverVenueRow } from "./DiscoverVenueRow";
import { AddVenuePanel } from "./AddVenuePanel";
import { RemovedVenueRow } from "./RemovedVenueRow";

export const metadata: Metadata = { title: "Discover Management" };
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────

type Props = { searchParams: Promise<Record<string, string>> };

export default async function DiscoverPage({ searchParams }: Props) {
  const { rail: rawRail } = await searchParams;
  const rail: RailKey = RAIL_KEYS.includes(rawRail as RailKey)
    ? (rawRail as RailKey)
    : "spotlight";

  const [venues, overrides] = await Promise.all([
    getPublishedVenuesForConsumer(),
    getRailOverridesForKey(rail),
  ]);

  // Build override lookup sets
  const overrideBrief: RailOverride[] = overrides.map((o) => ({
    venueUuid: o.venueUuid,
    action: o.action,
  }));
  const includeUuids = new Set(
    overrides.filter((o) => o.action === "include").map((o) => o.venueUuid)
  );
  const excludeUuids = new Set(
    overrides.filter((o) => o.action === "exclude").map((o) => o.venueUuid)
  );

  // ── Rail contents ──────────────────────────────────────────────────────────
  const isFeaturedEvents = rail === "featured-events";

  // For venue rails: run the engine to get current rail contents
  const railVenues = isFeaturedEvents
    ? []
    : getRailVenuesByKey(rail, venues, overrideBrief);

  // For Featured Events: collect venues that have events and are in the engine pool
  const eventVenues = isFeaturedEvents
    ? venues.filter(
        (v) =>
          !excludeUuids.has(v.venueUuid) &&
          isNearMarket(v.latitude, v.longitude) &&
          isDiscoverEligible(v) &&
          v.events.length > 0
      )
    : [];

  // Venues currently in the rail (by uuid)
  const railUuids = new Set(railVenues.map((v) => v.venueUuid));
  const eventVenueUuids = new Set(eventVenues.map((v) => v.venueUuid));

  // ── Removed venues ─────────────────────────────────────────────────────────
  // Venues with an active 'exclude' override for this rail
  const removedVenueMap = new Map(
    overrides.filter((o) => o.action === "exclude").map((o) => [o.venueUuid, o])
  );
  const removedVenues = venues.filter((v) => removedVenueMap.has(v.venueUuid));

  // ── Add candidates ─────────────────────────────────────────────────────────
  // Local eligible venues not already in the rail (for the add panel)
  const addCandidates = venues.filter(
    (v) =>
      isNearMarket(v.latitude, v.longitude) &&
      isDiscoverEligible(v) &&
      !railUuids.has(v.venueUuid) &&
      !eventVenueUuids.has(v.venueUuid) &&
      !excludeUuids.has(v.venueUuid)
  );

  // ── Rail counts for tab badges ─────────────────────────────────────────────
  // Quick count per rail — lightweight re-runs of engine functions without overrides
  const counts = Object.fromEntries(
    RAIL_KEYS.map((key) => {
      if (key === "featured-events") {
        return [key, getFeaturedEvents(venues).length];
      }
      return [key, getRailVenuesByKey(key, venues).length];
    })
  ) as Record<RailKey, number>;

  const totalInRail = isFeaturedEvents ? eventVenues.length : railVenues.length;

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

      {/* ── Featured Events special note ─────────────────────────────────── */}
      {isFeaturedEvents && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
          Events appear automatically for any published, discover-eligible local venue
          that has events. To remove a venue&apos;s events from this rail, use
          &quot;Nix from rail&quot; below. To remove a venue from all discovery,
          use the &quot;Exclude From Discover&quot; toggle.
        </div>
      )}

      {/* ── In-rail venue list ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 mb-4">
        {/* Column headers */}
        <div className="hidden sm:flex items-center gap-x-4 px-4 py-2 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wide">
          <span className="flex-1">Venue</span>
          <span className="w-16 text-right">Plan</span>
          <span className="w-16 text-right">Source</span>
          <span className="w-20 text-right">Boost</span>
          <span className="w-24 text-right">Exclude From Discover</span>
          <span className="w-20 text-right"></span>
        </div>

        {/* Venue rows */}
        {isFeaturedEvents ? (
          eventVenues.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400 text-center">
              No venues with events found.
            </p>
          ) : (
            eventVenues.map((v) => (
              <DiscoverVenueRow
                key={v.venueUuid}
                venue={v}
                railKey={rail}
                source={includeUuids.has(v.venueUuid) ? "override" : "algorithm"}
              />
            ))
          )
        ) : railVenues.length === 0 ? (
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

      {/* ── Add venue ─────────────────────────────────────────────────────── */}
      <AddVenuePanel candidates={addCandidates} railKey={rail} />

      {/* ── Removed from rail ─────────────────────────────────────────────── */}
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
