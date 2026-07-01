"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  getLocalSavedItems,
  unsaveVenue,
  unsaveEvent,
  migrateVenueId,
  type SavedItem,
} from "@/lib/consumer/savedItems";
import { dbUnsaveVenue, dbUnsaveEvent } from "@/lib/consumer/savedSync";
import { createClient } from "@/lib/supabase/browser";
import { useConsumerId } from "./ConsumerAuthProvider";
import type { VenuePreview } from "@/lib/data/venues";
import type { EventPreview } from "@/lib/data/events";

// ─── Types ────────────────────────────────────────────────────────────────────

// storedId is the key in localStorage (slug for legacy saves, UUID for new saves).
// It may differ from VenuePreview.id (which is always the DB UUID) for legacy items.
type VenueRow = VenuePreview & { savedAt: string; storedId: string };
type EventRow = EventPreview & { savedAt: string };

type FetchState = "idle" | "loading" | "done";

// ─── Heart icon (inline — no import needed) ───────────────────────────────────

const HEART_PATH =
  "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

// ─── SavedDropdown ────────────────────────────────────────────────────────────

type Props = {
  /** Active market slug — used to build /[market]/venue/[slug] links. */
  marketId: string;
  open: boolean;
  onClose: () => void;
};

const MAX_PREVIEW = 5;

export function SavedDropdown({ marketId, open, onClose }: Props) {
  const consumerId = useConsumerId();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  const [venueRows, setVenueRows] = useState<VenueRow[]>([]);
  const [eventRows, setEventRows] = useState<EventRow[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>("idle");

  // Total saved count — kept in sync with hhc:savedChanged so callers can
  // re-read totals after unsave.
  const [savedItems, setSavedItems] = useState(getLocalSavedItems);

  useEffect(() => {
    function onChanged() {
      setSavedItems(getLocalSavedItems());
    }
    window.addEventListener("hhc:savedChanged", onChanged);
    return () => window.removeEventListener("hhc:savedChanged", onChanged);
  }, []);

  // Fetch preview data when opened (lazy — only once per open).
  const fetchPreviews = useCallback(async () => {
    if (fetchState !== "idle") return;
    setFetchState("loading");

    const store = getLocalSavedItems();

    // Sort each list by savedAt descending (most recently saved first), take top MAX_PREVIEW.
    const topVenueItems: SavedItem[] = [...store.savedVenues]
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .slice(0, MAX_PREVIEW);

    const topEventItems: SavedItem[] = [...store.savedEvents]
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .slice(0, MAX_PREVIEW);

    const [venueData, eventData] = await Promise.all([
      topVenueItems.length > 0
        ? fetch("/api/consumer/saved-venues", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ venueIds: topVenueItems.map((v) => v.id) }),
          })
            .then((r) => (r.ok ? (r.json() as Promise<VenuePreview[]>) : []))
            .catch(() => [] as VenuePreview[])
        : Promise.resolve([] as VenuePreview[]),

      topEventItems.length > 0
        ? fetch("/api/consumer/saved-events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventIds: topEventItems.map((e) => e.id) }),
          })
            .then((r) => (r.ok ? (r.json() as Promise<EventPreview[]>) : []))
            .catch(() => [] as EventPreview[])
        : Promise.resolve([] as EventPreview[]),
    ]);

    // Build venue lookup keyed by both UUID (id) and slug so that legacy slug
    // saves resolve alongside new UUID saves without requiring a cache clear.
    const venueByStoredId: Record<string, VenuePreview> = {};
    for (const v of venueData) {
      venueByStoredId[v.id] = v;   // UUID key
      venueByStoredId[v.slug] = v; // slug key (legacy)
    }

    // Normalise localStorage: replace any stored slug with the resolved UUID
    // so future opens use the durable identifier without needing this fallback.
    for (const item of topVenueItems) {
      const preview = venueByStoredId[item.id];
      if (preview && item.id !== preview.id) {
        migrateVenueId(item.id, preview.id);
      }
    }

    setVenueRows(
      topVenueItems
        .filter((item) => venueByStoredId[item.id])
        .map((item) => {
          const preview = venueByStoredId[item.id];
          // After migration the localStorage key is now preview.id (UUID).
          return { ...preview, savedAt: item.savedAt, storedId: preview.id };
        })
    );

    const eventById = Object.fromEntries(eventData.map((e) => [e.id, e]));
    setEventRows(
      topEventItems
        .filter((item) => eventById[item.id])
        .map((item) => ({ ...eventById[item.id], savedAt: item.savedAt }))
    );

    setFetchState("done");
  }, [fetchState]);

  useEffect(() => {
    if (open && fetchState === "idle") {
      fetchPreviews();
    }
    // Reset fetch state when closed so re-open always gets fresh data.
    if (!open) {
      setFetchState("idle");
      setVenueRows([]);
      setEventRows([]);
    }
  }, [open, fetchState, fetchPreviews]);

  if (!open) return null;

  const isEmpty =
    savedItems.savedVenues.length === 0 && savedItems.savedEvents.length === 0;

  const hasMoreVenues = savedItems.savedVenues.length > MAX_PREVIEW;
  const hasMoreEvents = savedItems.savedEvents.length > MAX_PREVIEW;

  return (
    <div>
      <div
        role="dialog"
        aria-label="Saved items"
        className="
          absolute z-50
          right-0
          top-[calc(100%+6px)]
          w-80 max-w-[calc(100vw-24px)]
          bg-white rounded-2xl
          border border-gray-200
          shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]
          overflow-hidden
        "
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="px-4 pt-4 pb-3 border-b border-gray-100">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Saved
          </p>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <div className="max-h-[420px] overflow-y-auto">
          {isEmpty ? (
            /* ── Empty state ──────────────────────────────────────────────── */
            <div className="px-4 pt-5 pb-4 text-center">
              <div
                className="mx-auto mb-3 w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "#fef2f2" }}
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" style={{ width: 20, height: 20, fill: "none", stroke: "#f87171", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }} aria-hidden="true">
                  <path d={HEART_PATH} />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-800 mb-1">Nothing saved yet</p>
              <p className="text-xs text-gray-500 leading-relaxed">
                Tap the heart on any venue or event to save it for later.
              </p>
            </div>
          ) : (
            /* ── Saved items ──────────────────────────────────────────────── */
            <div className="py-2">
              {/* Venues section */}
              {savedItems.savedVenues.length > 0 && (
                <section>
                  <p className="px-4 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                    Venues
                  </p>
                  {fetchState !== "done" ? (
                    <LoadingRows count={Math.min(savedItems.savedVenues.length, MAX_PREVIEW)} />
                  ) : venueRows.length === 0 ? (
                    <p className="px-4 py-2 text-xs text-gray-400 italic">
                      Some saved venues could not be loaded.
                    </p>
                  ) : (
                    <>
                      {venueRows.map((v) => (
                        <VenueDropdownRow
                          key={v.storedId}
                          venue={v}
                          marketId={marketId}
                          onClose={onClose}
                          onUnsave={(storedId) => {
                            unsaveVenue(storedId);
                            setVenueRows((prev) => prev.filter((r) => r.storedId !== storedId));
                            if (consumerId) {
                              dbUnsaveVenue(getSupabase(), consumerId, storedId).catch(() => {});
                            }
                          }}
                        />
                      ))}
                      {hasMoreVenues && (
                        <p className="px-4 py-2 text-xs text-gray-400 italic">
                          +{savedItems.savedVenues.length - MAX_PREVIEW} more saved venues
                        </p>
                      )}
                    </>
                  )}
                </section>
              )}

              {/* Events section */}
              {savedItems.savedEvents.length > 0 && (
                <section className={savedItems.savedVenues.length > 0 ? "mt-1 border-t border-gray-100 pt-1" : ""}>
                  <p className="px-4 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                    Events
                  </p>
                  {fetchState !== "done" ? (
                    <LoadingRows count={Math.min(savedItems.savedEvents.length, MAX_PREVIEW)} />
                  ) : eventRows.length === 0 ? (
                    <p className="px-4 py-2 text-xs text-gray-400 italic">
                      Some saved events could not be loaded.
                    </p>
                  ) : (
                    <>
                      {eventRows.map((e) => (
                        <EventDropdownRow
                          key={e.id}
                          event={e}
                          onClose={onClose}
                          onUnsave={(id) => {
                            unsaveEvent(id);
                            setEventRows((prev) => prev.filter((r) => r.id !== id));
                            if (consumerId) {
                              dbUnsaveEvent(getSupabase(), consumerId, id).catch(() => {});
                            }
                          }}
                        />
                      ))}
                      {hasMoreEvents && (
                        <p className="px-4 py-2 text-xs text-gray-400 italic">
                          +{savedItems.savedEvents.length - MAX_PREVIEW} more saved events
                        </p>
                      )}
                    </>
                  )}
                </section>
              )}
            </div>
          )}
        </div>

        {/* ── View All Saved — always visible when there are saved items ────── */}
        {!isEmpty && (
          <div className="px-4 py-2.5 border-t border-gray-100">
            <Link
              href="/saved"
              onClick={onClose}
              className="flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-xl text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              View all saved
              <svg
                className="w-3.5 h-3.5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        )}

        {/* ── Account CTA — hidden when signed in ──────────────────────────── */}
        {!consumerId && (
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/60">
            <p className="text-[11px] text-gray-500 leading-snug mb-2">
              {isEmpty
                ? "Create a free account to sync saved places across devices."
                : "Create a free account to keep your saved places across devices."}
            </p>
            <Link
              href="/sign-up"
              className="block w-full py-2 px-3 rounded-xl text-xs font-semibold text-center bg-amber-500 hover:bg-amber-600 text-white transition-colors"
              onClick={onClose}
            >
              Create Free Account
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── VenueDropdownRow ─────────────────────────────────────────────────────────

function VenueDropdownRow({
  venue,
  marketId,
  onClose,
  onUnsave,
}: {
  venue: VenueRow;
  marketId: string;
  onClose: () => void;
  onUnsave: (id: string) => void;
}) {
  return (
    <div className="flex items-center px-4 py-2 hover:bg-gray-50 group transition-colors">
      {/* Thumbnail + text inside Link so the whole content area navigates */}
      <Link
        href={`/${marketId}/venue/${venue.slug}`}
        onClick={onClose}
        className="flex flex-1 min-w-0 items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
      >
        <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-gray-100">
          {venue.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={venue.imageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-amber-50 flex items-center justify-center">
              <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "none", stroke: "#d97706", strokeWidth: 2 }} aria-hidden="true">
                <path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><rect x="9" y="12" width="6" height="9" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-snug truncate">
            {venue.name}
          </p>
          {venue.city && (
            <p className="text-[11px] text-gray-400 leading-tight truncate">{venue.city}</p>
          )}
        </div>
      </Link>

      {/* Unsave button — sibling of Link, not nested inside it */}
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUnsave(venue.storedId); }}
        aria-label={`Remove ${venue.name} from saved`}
        className="shrink-0 p-1 ml-1.5 rounded-full text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "#ef4444", stroke: "#ef4444", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }} aria-hidden="true">
          <path d={HEART_PATH} />
        </svg>
      </button>
    </div>
  );
}

// ─── EventDropdownRow ─────────────────────────────────────────────────────────

function EventDropdownRow({
  event,
  onClose,
  onUnsave,
}: {
  event: EventRow;
  onClose: () => void;
  onUnsave: (id: string) => void;
}) {
  return (
    <div className="flex items-center px-4 py-2 hover:bg-gray-50 group transition-colors">
      {/* Thumbnail + text inside Link so the whole content area navigates */}
      <Link
        href={`/website-events/${event.id}`}
        onClick={onClose}
        className="flex flex-1 min-w-0 items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
      >
        <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-gray-100">
          {event.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.imageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-amber-50 flex items-center justify-center">
              <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "none", stroke: "#d97706", strokeWidth: 2 }} aria-hidden="true">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 leading-snug truncate">
            {event.title}
          </p>
          <p className="text-[11px] text-gray-400 leading-tight truncate">
            {event.venueName}
            {event.nextOccurrenceLabel ? ` · ${event.nextOccurrenceLabel}` : ""}
          </p>
        </div>
      </Link>

      {/* Unsave button — sibling of Link, not nested inside it */}
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUnsave(event.id); }}
        aria-label={`Remove ${event.title} from saved`}
        className="shrink-0 p-1 ml-1.5 rounded-full text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, fill: "#ef4444", stroke: "#ef4444", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }} aria-hidden="true">
          <path d={HEART_PATH} />
        </svg>
      </button>
    </div>
  );
}

// ─── LoadingRows ──────────────────────────────────────────────────────────────

function LoadingRows({ count }: { count: number }) {
  return (
    <div className="space-y-0.5 px-4 py-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 py-2 animate-pulse">
          <div className="w-9 h-9 rounded-lg bg-gray-100 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-gray-100 rounded w-3/4" />
            <div className="h-2.5 bg-gray-100 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
