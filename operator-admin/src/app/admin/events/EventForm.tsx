"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/browser";

// ── Types ─────────────────────────────────────────────────────────────────────

type EventFormState = {
  title: string;
  description: string;
  eventFrequency: string;
  eventTime: string;
  isPublished: boolean;
};

export type EventRow = {
  id: string;
  title: string | null;
  description: string | null;
  event_time: string | null;
  event_frequency: string | null;
  is_published: boolean;
  venue_id: string | null;
  created_by_operator_id: string | null;
};

type Props = {
  initialEvent?: EventRow | null;
  operatorId: string;
  venueId: string;
};

// ── Shared style constants ────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-60";

const labelCls = "block text-sm font-medium text-gray-700 mb-1";

const EMPTY: EventFormState = {
  title: "",
  description: "",
  eventFrequency: "",
  eventTime: "",
  isPublished: false,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function EventForm({ initialEvent, operatorId, venueId }: Props) {
  const [formState, setFormState] = useState<EventFormState>(EMPTY);
  // Tracks the saved event id — null until the first insert succeeds.
  const [currentEventId, setCurrentEventId] = useState<string | null>(
    initialEvent?.id ?? null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate form when initialEvent arrives (server SSR data or navigation).
  useEffect(() => {
    if (!initialEvent) return;
    setFormState({
      title: initialEvent.title ?? "",
      description: initialEvent.description ?? "",
      eventFrequency: initialEvent.event_frequency ?? "",
      eventTime: initialEvent.event_time ?? "",
      isPublished: initialEvent.is_published ?? false,
    });
    setCurrentEventId(initialEvent.id);
  }, [initialEvent]);

  function update<K extends keyof EventFormState>(key: K, value: EventFormState[K]) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    // Reset any in-flight saved badge timer.
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

    const supabase = createClient();

    if (currentEventId) {
      // ── Update existing event ──────────────────────────────────────────────
      const { error: updateError } = await supabase
        .from("events")
        .update({
          title: formState.title || null,
          description: formState.description || null,
          event_time: formState.eventTime || null,
          event_frequency: formState.eventFrequency || null,
          is_published: formState.isPublished,
          updated_at: new Date().toISOString(),
          updated_by_operator_id: operatorId,
        })
        .eq("id", currentEventId)
        .eq("created_by_operator_id", operatorId);

      if (updateError) {
        console.error("[EventForm] Update failed:", updateError);
        setError("Failed to save event. Please try again.");
        setIsSaving(false);
        return;
      }
    } else {
      // ── Insert new event ───────────────────────────────────────────────────
      const { data: inserted, error: insertError } = await supabase
        .from("events")
        .insert({
          title: formState.title || null,
          description: formState.description || null,
          event_time: formState.eventTime || null,
          event_frequency: formState.eventFrequency || null,
          is_published: formState.isPublished,
          venue_id: venueId,
          created_by_operator_id: operatorId,
          updated_by_operator_id: operatorId,
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("[EventForm] Insert failed:", insertError);
        setError("Failed to create event. Please try again.");
        setIsSaving(false);
        return;
      }

      // Keep the form in update mode for all subsequent saves.
      setCurrentEventId(inserted.id);
    }

    setIsSaving(false);
    setSaved(true);
    savedTimerRef.current = setTimeout(() => setSaved(false), 4000);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Title */}
      <div>
        <label htmlFor="event-title" className={labelCls}>
          Title
        </label>
        <input
          id="event-title"
          type="text"
          value={formState.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder="e.g. Tuesday Trivia Night"
          disabled={isSaving}
          className={inputCls}
        />
      </div>

      {/* Frequency + Time — side by side on wider screens */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="event-frequency" className={labelCls}>
            Frequency
          </label>
          <input
            id="event-frequency"
            type="text"
            value={formState.eventFrequency}
            onChange={(e) => update("eventFrequency", e.target.value)}
            placeholder="Every Tuesday"
            disabled={isSaving}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="event-time" className={labelCls}>
            Time
          </label>
          <input
            id="event-time"
            type="text"
            value={formState.eventTime}
            onChange={(e) => update("eventTime", e.target.value)}
            placeholder="6:30 PM"
            disabled={isSaving}
            className={inputCls}
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="event-description" className={labelCls}>
          Event details{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="event-description"
          rows={4}
          value={formState.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="Describe the event — what to expect, prizes, entry fee, etc."
          disabled={isSaving}
          className={inputCls + " resize-none"}
        />
      </div>

      {/* Published toggle */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={formState.isPublished}
          onClick={() => update("isPublished", !formState.isPublished)}
          disabled={isSaving}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            formState.isPublished ? "bg-amber-500" : "bg-gray-200"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              formState.isPublished ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
        <span className="text-sm font-medium text-gray-700">
          {formState.isPublished ? "Published" : "Unpublished"}
        </span>
        {!formState.isPublished && (
          <span className="text-xs text-gray-400">
            Visible only to you until published.
          </span>
        )}
      </div>

      {/* Save button + badge */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isSaving}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? "Saving…" : "Save event"}
        </button>
        {saved && (
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-green-100 text-green-700"
            role="status"
          >
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
