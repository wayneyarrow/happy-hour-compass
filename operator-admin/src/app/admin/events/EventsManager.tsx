"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import EventForm from "./EventForm";
import type { EventRow } from "./EventForm";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Columns fetched for both the initial server load and subsequent client re-fetches.
export const EVENT_COLUMNS =
  "id, title, description, first_date, start_time, end_time, recurrence, " +
  "event_time, event_frequency, is_published, venue_id, " +
  "created_by_operator_id, updated_by_operator_id";

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

// ── Component ─────────────────────────────────────────────────────────────────

type Mode = "idle" | "creating" | "editing";

type Props = {
  initialEvents: EventRow[];
  operatorId: string;
  venueId: string;
};

export default function EventsManager({ initialEvents, operatorId, venueId }: Props) {
  const [events, setEvents] = useState<EventRow[]>(initialEvents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("idle");

  const selectedEvent = events.find((e) => e.id === selectedId) ?? null;

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
      .eq("created_by_operator_id", operatorId)
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

  // After a successful delete, refresh the list and return to the idle empty state.
  const handleDeleted = async () => {
    await refreshList();
    setSelectedId(null);
    setMode("idle");
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

        {events.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-10 text-center">
            <p className="text-sm font-medium text-gray-600">No events yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Click &ldquo;+ New event&rdquo; to create your first event.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <ul className="divide-y divide-gray-100">
              {events.map((event) => {
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
          <div className="bg-white rounded-xl border border-gray-200 px-8 py-12 text-center">
            <p className="text-sm font-semibold text-gray-700">No event selected</p>
            <p className="text-sm text-gray-400 mt-1.5">
              Choose an event on the left or create a new one to get started.
            </p>
          </div>
        ) : (
          <>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              {mode === "creating" ? "New event" : "Edit event"}
            </h3>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
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
                onSaved={handleSaved}
                onDeleted={handleDeleted}
              />
            </div>
          </>
        )}
      </div>

    </div>
  );
}
