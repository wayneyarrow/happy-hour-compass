"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import EventForm from "./EventForm";
import type { EventRow } from "./EventForm";
import { deleteEventAction } from "./actions";
import type { OperatorPlan } from "@/lib/plans";
import { isRecurring } from "./recurrenceUtils";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Columns fetched for both the initial server load and subsequent client re-fetches.
export const EVENT_COLUMNS =
  "id, title, description, first_date, start_time, end_time, recurrence, " +
  "event_time, event_frequency, is_published, venue_id, image_url, " +
  "created_by_operator_id, updated_by_operator_id, updated_at";

/**
 * Builds the short schedule string shown in each list row.
 * Uses the already-derived legacy fields (event_frequency, event_time) so
 * no extra date parsing is needed here.
 */
function eventRowPreview(row: EventRow): string | null {
  const freq = row.event_frequency;
  const time = row.event_time;
  if (freq && time) return `${freq} · ${time}`;
  return freq ?? time ?? null;
}

// ── Filter & Sort ─────────────────────────────────────────────────────────────

type FilterOption = "all" | "upcoming" | "expired" | "recurring" | "draft" | "published";
type SortOption = "date_asc" | "date_desc" | "updated";

const FILTERS: { value: FilterOption; label: string }[] = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "expired", label: "Expired" },
  { value: "recurring", label: "Recurring" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "date_asc", label: "Date: soonest first" },
  { value: "date_desc", label: "Date: newest first" },
  { value: "updated", label: "Recently updated" },
];

const EMPTY_MESSAGES: Record<FilterOption, string> = {
  all: "No events yet",
  upcoming: "No upcoming events.",
  expired: "No expired events.",
  recurring: "No recurring events.",
  draft: "No draft events.",
  published: "No published events.",
};

function applyFilter(events: EventRow[], filter: FilterOption): EventRow[] {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  switch (filter) {
    case "upcoming":
      return events.filter((e) => e.first_date != null && e.first_date >= today);
    case "expired":
      return events.filter((e) => e.first_date != null && e.first_date < today);
    case "recurring":
      return events.filter((e) => isRecurring(e.recurrence ?? "none"));
    case "draft":
      return events.filter((e) => !e.is_published);
    case "published":
      return events.filter((e) => e.is_published);
    default:
      return events;
  }
}

function applySort(events: EventRow[], sort: SortOption): EventRow[] {
  return [...events].sort((a, b) => {
    if (sort === "date_asc") {
      if (a.first_date == null && b.first_date == null) return 0;
      if (a.first_date == null) return 1;
      if (b.first_date == null) return -1;
      return a.first_date < b.first_date ? -1 : a.first_date > b.first_date ? 1 : 0;
    }
    if (sort === "date_desc") {
      if (a.first_date == null && b.first_date == null) return 0;
      if (a.first_date == null) return 1;
      if (b.first_date == null) return -1;
      return a.first_date > b.first_date ? -1 : a.first_date < b.first_date ? 1 : 0;
    }
    // "updated" — most recently updated first; fall back to first_date then ""
    const aT = a.updated_at ?? a.first_date ?? "";
    const bT = b.updated_at ?? b.first_date ?? "";
    return bT > aT ? 1 : bT < aT ? -1 : 0;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

type Mode = "idle" | "creating" | "editing";

type Props = {
  initialEvents: EventRow[];
  operatorId: string;
  venueId: string;
  operatorPlan: OperatorPlan;
  isOwner: boolean;
};

export default function EventsManager({ initialEvents, operatorId, venueId, operatorPlan, isOwner }: Props) {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>(initialEvents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterOption>("all");
  const [activeSort, setActiveSort] = useState<SortOption>("date_asc");

  const selectedEvent = events.find((e) => e.id === selectedId) ?? null;

  const visibleEvents = useMemo(
    () => applySort(applyFilter(events, activeFilter), activeSort),
    [events, activeFilter, activeSort]
  );

  const handleSelectEvent = (id: string) => {
    setSelectedId(id);
    setMode("editing");
  };

  const handleNewEvent = () => {
    setSelectedId(null);
    setMode("creating");
  };

  const refreshList = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("venue_id", venueId)
      .order("first_date", { ascending: false })
      .order("title", { ascending: true });
    setEvents((data as unknown as EventRow[]) ?? []);
  };

  // After a successful save, refresh the list and return to the idle empty state.
  const handleSaved = async (_savedEventId: string) => {
    await refreshList();
    setSelectedId(null);
    setMode("idle");
  };

  // Confirm → server action delete → router.refresh() → reset to idle.
  const handleDelete = async () => {
    if (!selectedId) return;
    const confirmed = window.confirm(
      "Delete this event? This action cannot be undone."
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await deleteEventAction(selectedId);
      // revalidatePath was called server-side; router.refresh() picks it up.
      router.refresh();
      setSelectedId(null);
      setMode("idle");
      // Also update the local list immediately so the row disappears without
      // waiting for the router refresh to complete.
      setEvents((prev) => prev.filter((e) => e.id !== selectedId));
    } catch (err) {
      console.error("[EventsManager] Delete failed:", err);
      alert("Failed to delete event. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6 items-start">

      {/* ── Left panel: event list ───────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Your events
          </h3>
          <button
            type="button"
            onClick={handleNewEvent}
            className="px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
          >
            + New event
          </button>
        </div>

        {/* Filter & Sort controls — only shown when events exist */}
        {events.length > 0 && (
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveFilter(value)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    activeFilter === value
                      ? "bg-amber-500 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              value={activeSort}
              onChange={(e) => setActiveSort(e.target.value as SortOption)}
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 bg-white focus:ring-2 focus:ring-amber-400 focus:outline-none"
            >
              {SORT_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}

        {visibleEvents.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-10 text-center">
            <p className="text-sm font-medium text-gray-600">
              {EMPTY_MESSAGES[activeFilter]}
            </p>
            {activeFilter === "all" ? (
              <p className="text-xs text-gray-400 mt-1">
                Click &ldquo;+ New event&rdquo; to create your first event.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                className="mt-2 text-xs text-amber-600 hover:text-amber-700 font-medium"
              >
                Show all events
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <ul className="divide-y divide-gray-100">
              {visibleEvents.map((event) => {
                const isSelected = event.id === selectedId;
                const preview = eventRowPreview(event);

                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectEvent(event.id)}
                      className={`w-full text-left px-4 py-3 transition-colors border-l-[3px] ${
                        isSelected
                          ? "bg-amber-50 border-l-amber-500"
                          : "border-l-transparent hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p
                            className={`text-sm font-medium truncate ${
                              isSelected ? "text-amber-800" : "text-gray-800"
                            }`}
                          >
                            {event.title ?? (
                              <span className="text-gray-400 italic">Untitled</span>
                            )}
                          </p>
                          {preview && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate">
                              {preview}
                            </p>
                          )}
                        </div>
                        <span
                          className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                            event.is_published
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {event.is_published ? "Published" : "Draft"}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* ── Right panel ──────────────────────────────────────────────────── */}
      <div>
        {mode === "idle" ? (
          /* Empty state — shown on initial load and after any save or delete */
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-8 py-12 text-center">
            <p className="text-sm font-semibold text-gray-700">No event selected</p>
            <p className="text-sm text-gray-400 mt-1.5">
              Choose an event on the left or create a new one to get started.
            </p>
          </div>
        ) : (
          <>
            {/* Header row: label on left, actions on right (edit mode only) */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {mode === "creating" ? "New event" : "Edit event"}
              </h3>
              {mode === "editing" && (
                <div className="flex items-center gap-2">
                  <a
                    href={`/event/${selectedId}?preview=true`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors"
                  >
                    <span>Preview</span>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5"
                    >
                      <path d="M7 17L17 7" />
                      <path d="M7 7h10v10" />
                    </svg>
                  </a>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="text-sm font-semibold text-red-700 hover:text-red-800 border border-red-300 hover:border-red-400 hover:bg-red-50 rounded-full px-3 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isDeleting ? "Deleting…" : "Delete event"}
                  </button>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              {/*
                key={selectedId ?? "new"} forces a clean remount whenever the
                selection changes, giving EventForm a fresh empty state for "New
                event" and a clean hydration cycle when switching between rows.
              */}
              <EventForm
                key={selectedId ?? "new"}
                initialEvent={selectedEvent}
                operatorId={operatorId}
                venueId={venueId}
                operatorPlan={operatorPlan}
                isOwner={isOwner}
                onSaved={handleSaved}
              />
            </div>
          </>
        )}
      </div>

    </div>
  );
}
