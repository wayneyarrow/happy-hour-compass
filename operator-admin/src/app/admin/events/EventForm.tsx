"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/browser";
import { slugify } from "@/lib/slugify";

// ── Types ─────────────────────────────────────────────────────────────────────

type Recurrence = "none" | "daily" | "weekly" | "monthly";

type EventFormState = {
  title: string;
  firstDate: string;   // ISO "YYYY-MM-DD" or ""
  startTime: string;   // e.g. "7:00 PM" or ""
  endTime: string;     // e.g. "9:00 PM" or ""
  recurrence: Recurrence;
  description: string;
  isPublished: boolean;
};

export type EventRow = {
  id: string;
  title: string | null;
  description: string | null;
  first_date: string | null;
  start_time: string | null;
  end_time: string | null;
  recurrence: string | null;
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

// ── Constants ─────────────────────────────────────────────────────────────────

const DESCRIPTION_MAX = 280;

const KNOWN_RECURRENCES = new Set<Recurrence>(["none", "daily", "weekly", "monthly"]);

function toRecurrence(val: string | null | undefined): Recurrence {
  return val && KNOWN_RECURRENCES.has(val as Recurrence) ? (val as Recurrence) : "none";
}

// 30-minute increments from 10:00 AM to 11:30 PM
const TIME_OPTIONS: string[] = (() => {
  const opts: string[] = [];
  for (let h = 10; h < 24; h++) {
    for (const m of [0, 30]) {
      const hour12 = h > 12 ? h - 12 : h;
      const period = h >= 12 ? "PM" : "AM";
      opts.push(`${hour12}:${m === 0 ? "00" : "30"} ${period}`);
    }
  }
  return opts;
})();

const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: "none",    label: "One-time (no repeat)" },
  { value: "daily",   label: "Daily" },
  { value: "weekly",  label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const EMPTY: EventFormState = {
  title: "",
  firstDate: "",
  startTime: "",
  endTime: "",
  recurrence: "none",
  description: "",
  isPublished: false,
};

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Parse "YYYY-MM-DD" as a local date (avoids UTC midnight shifting the day). */
function parseDateLocal(dateStr: string): Date | null {
  if (!dateStr) return null;
  const [y, mo, d] = dateStr.split("-").map(Number);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d);
}

/** "2026-03-17" → "Tuesday" */
function weekdayNameFromDate(dateStr: string): string {
  const d = parseDateLocal(dateStr);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(d);
}

/** "2026-03-17" → "17th" */
function dayOfMonthFromDate(dateStr: string): string {
  const d = parseDateLocal(dateStr);
  if (!d) return "";
  const n = d.getDate();
  const suffix =
    n === 1 || n === 21 || n === 31 ? "st" :
    n === 2 || n === 22 ? "nd" :
    n === 3 || n === 23 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** "2026-03-17" → "Mar 17, 2026" */
function formatDate(dateStr: string): string {
  const d = parseDateLocal(dateStr);
  if (!d) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

// ── Preview ───────────────────────────────────────────────────────────────────

function getDateTimePreview(state: EventFormState): string | null {
  const { firstDate, startTime, endTime, recurrence } = state;
  if (!firstDate || !startTime) return null;
  const endPart = endTime ? ` – ${endTime}` : "";
  switch (recurrence) {
    case "weekly":
      return `Every ${weekdayNameFromDate(firstDate)} · ${startTime}${endPart}`;
    case "daily":
      return `Every day · ${startTime}${endPart}`;
    case "monthly":
      return `Every month on the ${dayOfMonthFromDate(firstDate)} · ${startTime}${endPart}`;
    case "none":
    default:
      return `${formatDate(firstDate)} · ${startTime}${endPart}`;
  }
}

// ── Legacy field derivation (backward-compat for consumer app) ─────────────────

function deriveEventTime(startTime: string, endTime: string): string | null {
  if (!startTime) return null;
  return endTime ? `${startTime} – ${endTime}` : startTime;
}

function deriveEventFrequency(recurrence: Recurrence, firstDate: string): string | null {
  switch (recurrence) {
    case "weekly":
      return firstDate ? `Every ${weekdayNameFromDate(firstDate)}` : "Weekly";
    case "daily":
      return "Every day";
    case "monthly":
      return firstDate ? `Every month on the ${dayOfMonthFromDate(firstDate)}` : "Monthly";
    case "none":
    default:
      return firstDate ? formatDate(firstDate) : null;
  }
}

// ── Style constants ───────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-60";

const labelCls = "block text-sm font-medium text-gray-700 mb-1";

// ── Component ─────────────────────────────────────────────────────────────────

export default function EventForm({ initialEvent, operatorId, venueId }: Props) {
  const [formState, setFormState] = useState<EventFormState>(EMPTY);
  const [currentEventId, setCurrentEventId] = useState<string | null>(
    initialEvent?.id ?? null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from server-loaded event data.
  useEffect(() => {
    if (!initialEvent) return;
    setFormState({
      title: initialEvent.title ?? "",
      firstDate: initialEvent.first_date ?? "",
      startTime: initialEvent.start_time ?? "",
      endTime: initialEvent.end_time ?? "",
      recurrence: toRecurrence(initialEvent.recurrence),
      description: initialEvent.description ?? "",
      isPublished: initialEvent.is_published ?? false,
    });
    setCurrentEventId(initialEvent.id);
  }, [initialEvent]);

  function update<K extends keyof EventFormState>(key: K, value: EventFormState[K]) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // ── Validation ────────────────────────────────────────────────────────
    if (!formState.firstDate) {
      setError("Please pick a date for the first occurrence.");
      return;
    }
    if (!formState.startTime) {
      setError("Please select a start time.");
      return;
    }
    if (formState.endTime) {
      const si = TIME_OPTIONS.indexOf(formState.startTime);
      const ei = TIME_OPTIONS.indexOf(formState.endTime);
      if (si !== -1 && ei !== -1 && ei <= si) {
        setError("End time must be after the start time.");
        return;
      }
    }

    setIsSaving(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

    // ── Derive legacy fields ──────────────────────────────────────────────
    const event_time = deriveEventTime(formState.startTime, formState.endTime);
    const event_frequency = deriveEventFrequency(formState.recurrence, formState.firstDate);

    const sharedFields = {
      title: formState.title || null,
      description: formState.description || null,
      first_date: formState.firstDate || null,
      start_time: formState.startTime || null,
      end_time: formState.endTime || null,
      recurrence: formState.recurrence,
      event_time,
      event_frequency,
      is_published: formState.isPublished,
      updated_by_operator_id: operatorId,
    };

    const supabase = createClient();

    if (currentEventId) {
      // ── Update ──────────────────────────────────────────────────────────
      const { error: updateError } = await supabase
        .from("events")
        .update({ ...sharedFields, updated_at: new Date().toISOString() })
        .eq("id", currentEventId)
        .eq("created_by_operator_id", operatorId);

      if (updateError) {
        console.error("[EventForm] Update failed:", updateError);
        setError(updateError.message || "Failed to save event. Please try again.");
        setIsSaving(false);
        return;
      }
    } else {
      // ── Insert ──────────────────────────────────────────────────────────
      const baseSlug = slugify(formState.title);
      const slug = baseSlug || crypto.randomUUID();

      const { data: inserted, error: insertError } = await supabase
        .from("events")
        .insert([{
          ...sharedFields,
          slug,
          venue_id: venueId,
          created_by_operator_id: operatorId,
        }])
        .select()
        .single();

      if (insertError) {
        console.error("[EventForm] Insert failed:", insertError);
        setError(insertError.message || "Failed to create event. Please try again.");
        setIsSaving(false);
        return;
      }

      setCurrentEventId(inserted.id);
    }

    setIsSaving(false);
    setSaved(true);
    savedTimerRef.current = setTimeout(() => setSaved(false), 4000);
  };

  const preview = getDateTimePreview(formState);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* 1. Title */}
      <div>
        <label htmlFor="event-title" className={labelCls}>
          Event name
        </label>
        <input
          id="event-title"
          type="text"
          value={formState.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder="e.g. Music Bingo"
          disabled={isSaving}
          className={inputCls}
        />
      </div>

      {/* 2. Date of first occurrence */}
      <div>
        <label htmlFor="event-first-date" className={labelCls}>
          Date of first occurrence
        </label>
        <input
          id="event-first-date"
          type="date"
          value={formState.firstDate}
          onChange={(e) => update("firstDate", e.target.value)}
          disabled={isSaving}
          className={inputCls}
        />
      </div>

      {/* 3. Start time / End time */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="event-start-time" className={labelCls}>
            Start time
          </label>
          <select
            id="event-start-time"
            value={formState.startTime}
            onChange={(e) => update("startTime", e.target.value)}
            disabled={isSaving}
            className={inputCls}
          >
            <option value="">Select time</option>
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="event-end-time" className={labelCls}>
            End time{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <select
            id="event-end-time"
            value={formState.endTime}
            onChange={(e) => update("endTime", e.target.value)}
            disabled={isSaving}
            className={inputCls}
          >
            <option value="">No end time</option>
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 4. Recurrence */}
      <div>
        <label htmlFor="event-recurrence" className={labelCls}>
          Repeats
        </label>
        <select
          id="event-recurrence"
          value={formState.recurrence}
          onChange={(e) => update("recurrence", e.target.value as Recurrence)}
          disabled={isSaving}
          className={inputCls}
        >
          {RECURRENCE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Date & Time preview — hidden until both date and start time are set */}
      {preview && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">
            Date &amp; time preview
          </p>
          <p className="text-sm font-medium text-gray-700">{preview}</p>
        </div>
      )}

      {/* 5. Description with character limit */}
      <div>
        <label htmlFor="event-description" className={labelCls}>
          Event details{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="event-description"
          rows={4}
          value={formState.description}
          onChange={(e) =>
            update("description", e.target.value.slice(0, DESCRIPTION_MAX))
          }
          placeholder="Describe the event — what to expect, prizes, entry fee, etc."
          disabled={isSaving}
          className={inputCls + " resize-none"}
        />
        <p className="mt-1 text-xs text-gray-400 text-right tabular-nums">
          {formState.description.length} / {DESCRIPTION_MAX} characters
        </p>
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
