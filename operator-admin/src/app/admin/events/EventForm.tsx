"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/browser";
import {
  processImageFile,
  ImageTooLargeError,
  InvalidImageTypeError,
} from "@/lib/imageProcessing";
import Link from "next/link";
import { canUseRecurringEvents } from "@/lib/plans";
import type { OperatorPlan } from "@/lib/plans";
import {
  type Recurrence,
  isRecurring,
  toRecurrence,
} from "./recurrenceUtils";
import { saveEventAction } from "./actions";
import { EVENT_TYPE_OPTIONS } from "@/lib/eventTypes";

// ── Types ─────────────────────────────────────────────────────────────────────

type EventFormState = {
  title: string;
  eventType: string;   // EventTypeKey or "" (not yet chosen)
  firstDate: string;   // ISO "YYYY-MM-DD" or ""
  startTime: string;   // e.g. "7:00 PM" or ""
  endTime: string;     // e.g. "9:00 PM" or ""
  recurrence: Recurrence;
  description: string;
  isPublished: boolean;
  ticketingEnabled: boolean;
  ticketUrl: string;
  soldOut: boolean;
  // Premium landing page fields (migration 050)
  priceDisplay: string;
  ageRestriction: string;
  reservationRecommendation: string;
  parkingNotes: string;
  accessibilityNotes: string;
  teaser: string;
};

export type EventRow = {
  id: string;
  title: string | null;
  description: string | null;
  event_type: string | null;
  first_date: string | null;
  start_time: string | null;
  end_time: string | null;
  recurrence: string | null;
  event_time: string | null;
  event_frequency: string | null;
  is_published: boolean;
  venue_id: string | null;
  created_by_operator_id: string | null;
  image_url: string | null;
  ticketing_enabled: boolean;
  ticket_url: string | null;
  sold_out: boolean;
  is_seeded_event: boolean;
  updated_at?: string | null;
  // Premium landing page fields (migration 050)
  price_display: string | null;
  age_restriction: string | null;
  reservation_recommendation: string | null;
  parking_notes: string | null;
  accessibility_notes: string | null;
  teaser: string | null;
};

type Props = {
  initialEvent?: EventRow | null;
  operatorId: string;
  venueId: string;
  operatorPlan: OperatorPlan;
  /** Whether the current user is the account owner (controls CTA wording). */
  isOwner: boolean;
  /** Called after a successful insert or update with the saved event's id. */
  onSaved?: (eventId: string) => void;
  /** Called when the operator backs out of the initial "New event" step without creating a draft. Only rendered while no draft exists yet. */
  onCancel?: () => void;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const DESCRIPTION_MAX = 280;

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

const AGE_RESTRICTION_OPTIONS = [
  "All Ages",
  "18+",
  "19+",
  "21+",
  "Other",
];

const RESERVATION_OPTIONS = [
  "No Reservation Needed",
  "Reservations Recommended",
  "Reservations Required",
];

const EMPTY: EventFormState = {
  title: "",
  eventType: "",
  firstDate: "",
  startTime: "",
  endTime: "",
  recurrence: "none",
  description: "",
  isPublished: false,
  ticketingEnabled: false,
  ticketUrl: "",
  soldOut: false,
  priceDisplay: "",
  ageRestriction: "",
  reservationRecommendation: "",
  parkingNotes: "",
  accessibilityNotes: "",
  teaser: "",
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

// ── Style constants ───────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-60";

const labelCls = "block text-sm font-medium text-gray-700 mb-1";
const labelOptCls = "block text-sm font-medium text-gray-500 mb-1";
const sectionHeadingCls = "text-xs font-semibold text-gray-500 uppercase tracking-wider";

// ── Component ─────────────────────────────────────────────────────────────────
//
// Progressive creation, matching the established Collections pattern
// (control-panel/collections/CollectionForm.tsx — see that file's "Continue"
// button/module docstring): a brand new event (no id yet) shows only the
// minimum field needed to safely create an unpublished draft — Event name,
// the one column the events table requires NOT NULL — behind a "Continue"
// action. Once the draft exists (currentEventId is set, whether from a
// fresh Continue or because an existing event was opened for editing), the
// full editor renders — every other field is either nullable or has a safe
// server-side default, so nothing else blocks draft creation. Event Image
// is therefore never shown in a disabled "come back later" state — it isn't
// reachable until currentEventId already exists.
//
// Unlike Collections (a route-based create page that redirects to a
// separate edit route), Events lives in one client-side panel
// (EventsManager) with no per-event URL. The "initial step → full editor"
// transition here is a local state change (currentEventId becoming
// non-null) rather than a page navigation — EventsManager remounts this
// component against the newly created row (see its handleSaved), which is
// the closest equivalent available without introducing new routes/URLs for
// Events, which is out of scope for this change.
export default function EventForm({ initialEvent, operatorId, venueId, operatorPlan, isOwner, onSaved, onCancel }: Props) {
  const [formState, setFormState] = useState<EventFormState>(EMPTY);
  const [currentEventId, setCurrentEventId] = useState<string | null>(
    initialEvent?.id ?? null
  );
  const [imageUrl, setImageUrl] = useState<string | null>(
    initialEvent?.image_url ?? null
  );
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Field-adjacent errors for the two fields most often missed on save
  // (see handleSubmit) — shown next to the field itself, in addition to the
  // summary banner above, so the operator doesn't have to scroll up to learn
  // what to fix.
  const [firstDateError, setFirstDateError] = useState<string | null>(null);
  const [startTimeError, setStartTimeError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [recurrenceUpsellVisible, setRecurrenceUpsellVisible] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Extra defensive guard against a double-submit racing ahead of React's
  // isSaving-driven disabled state (e.g. a very fast double click/tap) —
  // belt-and-suspenders alongside the disabled button and the fact that,
  // once Continue succeeds, the initial step (and its Continue button)
  // unmounts entirely, so there is no way to submit it a second time.
  const submittingRef = useRef(false);

  const canRecur = canUseRecurringEvents(operatorPlan);

  // Hydrate from server-loaded event data.
  useEffect(() => {
    if (!initialEvent) return;
    setFormState({
      title: initialEvent.title ?? "",
      eventType: initialEvent.event_type ?? "",
      firstDate: initialEvent.first_date ?? "",
      startTime: initialEvent.start_time ?? "",
      endTime: initialEvent.end_time ?? "",
      recurrence: toRecurrence(initialEvent.recurrence),
      description: initialEvent.description ?? "",
      isPublished: initialEvent.is_published ?? false,
      ticketingEnabled: initialEvent.ticketing_enabled ?? false,
      ticketUrl: initialEvent.ticket_url ?? "",
      soldOut: initialEvent.sold_out ?? false,
      priceDisplay: initialEvent.price_display ?? "",
      ageRestriction: initialEvent.age_restriction ?? "",
      reservationRecommendation: initialEvent.reservation_recommendation ?? "",
      parkingNotes: initialEvent.parking_notes ?? "",
      accessibilityNotes: initialEvent.accessibility_notes ?? "",
      teaser: initialEvent.teaser ?? "",
    });
    setCurrentEventId(initialEvent.id);
    setImageUrl(initialEvent.image_url ?? null);
  }, [initialEvent]);

  function update<K extends keyof EventFormState>(key: K, value: EventFormState[K]) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);

    // ── Initial step: Continue — create the draft ─────────────────────────
    // Only the event name is validated/sent here. Every other events column
    // is nullable or has a safe server-side default (see saveEventAction),
    // so nothing else is required to safely create an unpublished draft.
    // isPublished is hard-coded false — Continue must never publish.
    if (!currentEventId) {
      if (!formState.title.trim()) {
        setError("Please enter an event name to continue.");
        return;
      }

      submittingRef.current = true;
      setIsSaving(true);

      const result = await saveEventAction(
        {
          venueId,
          title: formState.title,
          eventType: null,
          description: null,
          firstDate: "",
          startTime: "",
          endTime: null,
          recurrence: "none",
          isPublished: false,
          ticketingEnabled: false,
          ticketUrl: null,
          soldOut: false,
          priceDisplay: null,
          ageRestriction: null,
          reservationRecommendation: null,
          parkingNotes: null,
          accessibilityNotes: null,
          teaser: null,
        },
        null
      );

      submittingRef.current = false;

      if ("error" in result) {
        setError(result.error);
        setIsSaving(false);
        return;
      }

      setCurrentEventId(result.savedId);
      setIsSaving(false);
      onSaved?.(result.savedId);
      return;
    }

    // ── Full editor: Save changes ──────────────────────────────────────────
    setFirstDateError(null);
    setStartTimeError(null);

    // ── Validation ────────────────────────────────────────────────────────
    if (formState.isPublished && !formState.eventType) {
      setError("Please select an event type before publishing.");
      return;
    }
    if (!formState.firstDate) {
      const msg = "Please pick a date for the first occurrence.";
      setError(msg);
      setFirstDateError(msg);
      return;
    }
    if (!formState.startTime) {
      const msg = "Please select a start time.";
      setError(msg);
      setStartTimeError(msg);
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

    // ── Ticket URL validation ─────────────────────────────────────────────
    if (formState.ticketingEnabled && formState.ticketUrl) {
      try {
        const url = new URL(formState.ticketUrl);
        if (url.protocol !== "https:" && url.protocol !== "http:") {
          setError("Ticket URL must start with https:// or http://");
          return;
        }
      } catch {
        setError("Ticket URL is not a valid URL. It must start with https://");
        return;
      }
    }
    if (formState.ticketingEnabled && !formState.ticketUrl) {
      setError("Please enter a Ticket URL, or uncheck \"Enable Ticket Sales\".");
      return;
    }

    // ── Image required to publish ─────────────────────────────────────────
    if (formState.isPublished && !imageUrl) {
      setError("An event image is required to publish. Upload an image first, or save as unpublished.");
      return;
    }

    submittingRef.current = true;
    setIsSaving(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

    const result = await saveEventAction(
      {
        venueId,
        title: formState.title || null,
        eventType: formState.eventType || null,
        description: formState.description || null,
        firstDate: formState.firstDate,
        startTime: formState.startTime,
        endTime: formState.endTime || null,
        recurrence: formState.recurrence,
        isPublished: formState.isPublished,
        ticketingEnabled: formState.ticketingEnabled,
        ticketUrl: formState.ticketUrl || null,
        soldOut: formState.soldOut,
        priceDisplay: formState.priceDisplay || null,
        ageRestriction: formState.ageRestriction || null,
        reservationRecommendation: formState.reservationRecommendation || null,
        parkingNotes: formState.parkingNotes || null,
        accessibilityNotes: formState.accessibilityNotes || null,
        teaser: formState.teaser || null,
      },
      currentEventId
    );

    submittingRef.current = false;

    if ("error" in result) {
      setError(result.error);
      setIsSaving(false);
      return;
    }

    setCurrentEventId(result.savedId);
    setIsSaving(false);
    setSaved(true);
    savedTimerRef.current = setTimeout(() => setSaved(false), 4000);
    onSaved?.(result.savedId);
  };

  // ── Image upload / remove ─────────────────────────────────────────────────
  // Both require currentEventId, which is always set by the time this
  // section can render (see the `!currentEventId` early return in the JSX
  // below) — the guards here are defensive, not reachable through normal use.

  const handleImageUpload = async (file: File) => {
    if (!currentEventId) return;
    setImageError(null);
    setIsUploadingImage(true);
    if (imageInputRef.current) imageInputRef.current.value = "";

    // ── Process (resize + compress) before upload ─────────────────────────
    let blob: Blob;
    try {
      blob = await processImageFile(file, {
        maxWidth: 1600,
        maxSizeBytes: 1.5 * 1024 * 1024,
      });
    } catch (err) {
      if (err instanceof InvalidImageTypeError) {
        setImageError("Please upload a valid image file.");
      } else if (err instanceof ImageTooLargeError) {
        setImageError(
          "This image is too large even after compression. Please choose a smaller image."
        );
      } else {
        setImageError("Failed to process image. Please try again.");
      }
      setIsUploadingImage(false);
      return;
    }

    const supabase = createClient();
    // Always store as .jpg (output is always JPEG after processing).
    const path = `events/${currentEventId}/${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("venue-images")
      .upload(path, blob, { cacheControl: "3600", upsert: true, contentType: "image/jpeg" });

    if (uploadError) {
      console.error("[EventForm] Image upload failed:", uploadError);
      setImageError(`Upload failed: ${uploadError.message}`);
      setIsUploadingImage(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from("venue-images")
      .getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    const { error: updateError } = await supabase
      .from("events")
      .update({ image_url: publicUrl })
      .eq("id", currentEventId)
      .eq("created_by_operator_id", operatorId);

    if (updateError) {
      console.error("[EventForm] image_url update failed:", updateError);
      setImageError(`Failed to save image: ${updateError.message}`);
      // Best-effort: remove the just-uploaded file to avoid orphans.
      await supabase.storage.from("venue-images").remove([path]);
      setIsUploadingImage(false);
      return;
    }

    setImageUrl(publicUrl);
    setPublishError(null); // image requirement now met — clear any publish error
    setIsUploadingImage(false);
  };

  const handleImageRemove = async () => {
    if (!currentEventId) return;
    setImageError(null);
    setIsUploadingImage(true);

    const supabase = createClient();

    const { error: updateError } = await supabase
      .from("events")
      .update({ image_url: null })
      .eq("id", currentEventId)
      .eq("created_by_operator_id", operatorId);

    if (updateError) {
      console.error("[EventForm] image_url remove failed:", updateError);
      setImageError(`Failed to remove image: ${updateError.message}`);
      setIsUploadingImage(false);
      return;
    }

    // Best-effort: also delete the file from storage.
    if (imageUrl) {
      try {
        const urlObj = new URL(imageUrl);
        const match = urlObj.pathname.match(/\/public\/[^/]+\/(.+)$/);
        if (match?.[1]) {
          await supabase.storage.from("venue-images").remove([match[1]]);
        }
      } catch {
        // Non-fatal — the DB row is already cleared.
      }
    }

    setImageUrl(null);
    setIsUploadingImage(false);
  };

  const preview = getDateTimePreview(formState);

  // ── Initial step: only the field required to create a safe draft ─────────
  if (!currentEventId) {
    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <strong>Error:</strong> {error}
          </div>
        )}

        <p className="text-sm text-gray-500">
          Start with your event name. You&rsquo;ll add the schedule, image, and other
          details next.
        </p>

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
            autoFocus
            className={inputCls}
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={isSaving || !formState.title.trim()}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "Creating…" : "Continue"}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          )}
        </div>

        <p className="text-xs text-gray-400">
          This event is created as a draft — you&rsquo;ll set the schedule, add an
          image, and publish it next.
        </p>
      </form>
    );
  }

  // ── Full editor ────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Section 1: Event Basics ──────────────────────────────────────── */}
      <div className="space-y-4">
        <h3 className={sectionHeadingCls}>Event Basics</h3>

        {/* Event Name */}
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

        {/* Event Type */}
        <div>
          <label htmlFor="event-type" className={labelCls}>
            Event type
          </label>
          <select
            id="event-type"
            value={formState.eventType}
            onChange={(e) => update("eventType", e.target.value)}
            disabled={isSaving}
            className={inputCls}
          >
            <option value="">Select event type</option>
            {EVENT_TYPE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
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

        {/* Teaser */}
        <div>
          <label htmlFor="event-teaser" className={labelCls}>
            Teaser{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="event-teaser"
            rows={2}
            value={formState.teaser}
            onChange={(e) => update("teaser", e.target.value)}
            placeholder="e.g. Half-price wings, live jazz, and a patio you won't want to leave."
            disabled={isSaving}
            className={inputCls + " resize-none"}
          />
          <p className="mt-1 text-xs text-gray-400">
            A short, compelling sentence used when this venue, event, or guide is featured
            throughout Happy Hour Compass. Aim for one sentence that encourages someone to click
            and learn more.
          </p>
        </div>

        {/* Event Image — always available here: this section only ever
            renders once currentEventId exists (see the early return above),
            so there is no disabled/"come back later" state to show. */}
        <div>
          {/* Shared hidden file input — triggered by both Upload and Replace */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={isUploadingImage || isSaving}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImageUpload(file);
            }}
          />

          <p className={labelCls}>
            Event image{" "}
            <span className="text-gray-400 font-normal">(required to publish)</span>
          </p>
          <p className="text-xs text-gray-400 mb-3">
            Upload a single image for the event listing and detail page.
          </p>

          {imageError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
              {imageError}
            </div>
          )}

          {imageUrl ? (
            <div className="flex items-start gap-4">
              <div className="w-24 h-24 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="Event image"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isUploadingImage || isSaving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUploadingImage ? "Uploading…" : "Replace image"}
                </button>
                <button
                  type="button"
                  onClick={handleImageRemove}
                  disabled={isUploadingImage || isSaving}
                  className="text-xs text-red-500 hover:text-red-600 font-medium text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Remove image
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={isUploadingImage || isSaving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                className="w-4 h-4 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0L8 8m4-4l4 4"
                />
              </svg>
              {isUploadingImage ? "Uploading…" : "Upload image"}
            </button>
          )}
        </div>
      </div>

      {/* ── Section 2: Schedule ──────────────────────────────────────────── */}
      <div className="pt-5 border-t border-gray-100 space-y-4">
        <h3 className={sectionHeadingCls}>Schedule</h3>

        {/* Date of first occurrence */}
        <div>
          <label htmlFor="event-first-date" className={labelCls}>
            Date of first occurrence
          </label>
          <input
            id="event-first-date"
            type="date"
            value={formState.firstDate}
            onChange={(e) => {
              update("firstDate", e.target.value);
              if (firstDateError) setFirstDateError(null);
            }}
            disabled={isSaving}
            aria-invalid={!!firstDateError}
            className={inputCls}
          />
          {firstDateError && (
            <p className="mt-1 text-xs text-red-600">{firstDateError}</p>
          )}
        </div>

        {/* Start time / End time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="event-start-time" className={labelCls}>
              Start time
            </label>
            <select
              id="event-start-time"
              value={formState.startTime}
              onChange={(e) => {
                update("startTime", e.target.value);
                if (startTimeError) setStartTimeError(null);
              }}
              disabled={isSaving}
              aria-invalid={!!startTimeError}
              className={inputCls}
            >
              <option value="">Select time</option>
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {startTimeError && (
              <p className="mt-1 text-xs text-red-600">{startTimeError}</p>
            )}
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

        {/* Recurrence */}
        <div>
          <label htmlFor="event-recurrence" className={labelCls}>
            Repeats
          </label>
          {/* Downgrade notice: existing recurring event on free plan */}
          {!canRecur && initialEvent && isRecurring(formState.recurrence) && (
            <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-800">
              This event has a recurring schedule from a previous plan. To edit the
              schedule, upgrade to Pro or switch &ldquo;Repeats&rdquo; to{" "}
              &ldquo;One-time&rdquo; to save other changes.{" "}
              {isOwner ? (
                <Link
                  href="/admin/subscription"
                  className="font-semibold underline underline-offset-2 hover:text-amber-900 transition-colors"
                >
                  Change your plan →
                </Link>
              ) : (
                <span className="text-amber-700">Ask the admin to change the plan.</span>
              )}
            </div>
          )}
          <select
            id="event-recurrence"
            value={formState.recurrence}
            onChange={(e) => {
              const val = e.target.value as Recurrence;
              if (isRecurring(val) && !canRecur) {
                setRecurrenceUpsellVisible(true);
                return;
              }
              setRecurrenceUpsellVisible(false);
              update("recurrence", val);
            }}
            disabled={isSaving}
            className={inputCls}
          >
            {RECURRENCE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {isRecurring(value) && !canRecur ? `${label} (Pro+)` : label}
              </option>
            ))}
          </select>
          {recurrenceUpsellVisible && (
            <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <svg
                  className="w-3.5 h-3.5 shrink-0 text-amber-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
                <p className="text-sm font-semibold text-amber-900">Recurring Events</p>
              </div>
              <p className="text-sm text-amber-800 leading-snug">
                Create an event once and automatically repeat it — daily, weekly, or monthly.
                No re-entering details each time.
              </p>
              <p className="text-xs text-amber-700">
                Great for trivia nights, karaoke, live music, weekly specials, and regular promotions.
              </p>
              <p className="text-xs font-medium text-amber-800 pt-0.5">
                Available on Pro and Premium plans.{" "}
                {isOwner ? (
                  <Link
                    href="/admin/subscription"
                    className="font-semibold underline underline-offset-2 hover:text-amber-900 transition-colors"
                  >
                    Change your plan →
                  </Link>
                ) : (
                  <span className="text-amber-700">Ask the admin to change the plan.</span>
                )}
              </p>
            </div>
          )}
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
      </div>

      {/* ── Section 3: Tickets ───────────────────────────────────────────── */}
      <div className="pt-5 border-t border-gray-100 space-y-3">
        <h3 className={sectionHeadingCls}>Tickets</h3>

        {/* Enable Ticket Sales */}
        <div className="flex items-center gap-3">
          <input
            id="ticketing-enabled"
            type="checkbox"
            checked={formState.ticketingEnabled}
            onChange={(e) => {
              update("ticketingEnabled", e.target.checked);
              if (!e.target.checked) {
                update("soldOut", false);
              }
            }}
            disabled={isSaving}
            className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 disabled:opacity-60 cursor-pointer"
          />
          <label htmlFor="ticketing-enabled" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
            Enable Ticket Sales
          </label>
        </div>

        {/* Ticket URL — only shown when ticketing is enabled */}
        {formState.ticketingEnabled && (
          <div>
            <label htmlFor="ticket-url" className={labelCls}>
              Ticket URL
            </label>
            <input
              id="ticket-url"
              type="url"
              value={formState.ticketUrl}
              onChange={(e) => update("ticketUrl", e.target.value)}
              placeholder="https://www.eventbrite.com/e/your-event"
              disabled={isSaving}
              className={inputCls}
            />
            <p className="mt-1 text-xs text-gray-400">
              Where customers can buy tickets. Must start with https://
            </p>
          </div>
        )}

        {/* Sold Out — only shown when ticketing is enabled */}
        {formState.ticketingEnabled && (
          <div className="flex items-center gap-3">
            <input
              id="sold-out"
              type="checkbox"
              checked={formState.soldOut}
              onChange={(e) => update("soldOut", e.target.checked)}
              disabled={isSaving}
              className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 disabled:opacity-60 cursor-pointer"
            />
            <label htmlFor="sold-out" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
              Sold Out
            </label>
            {formState.soldOut && (
              <span className="text-xs text-gray-400">
                Consumers will see &ldquo;Sold Out&rdquo; instead of a ticket link.
              </span>
            )}
          </div>
        )}

        {/* Price Display */}
        <div>
          <label htmlFor="price-display" className={labelCls}>
            Price{" "}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="price-display"
            type="text"
            value={formState.priceDisplay}
            onChange={(e) => update("priceDisplay", e.target.value)}
            placeholder="e.g. Free · $20 · $25–35 · By Donation"
            disabled={isSaving}
            className={inputCls}
          />
        </div>
      </div>

      {/* ── Section 4: Know Before You Go ────────────────────────────────── */}
      <div className="pt-5 border-t border-gray-100 space-y-4">
        <div>
          <h3 className={sectionHeadingCls}>Know Before You Go</h3>
          <p className="text-xs text-gray-400 mt-1">
            Help guests prepare — all fields are optional.
          </p>
        </div>

        {/* Age Restriction */}
        <div>
          <label htmlFor="age-restriction" className={labelOptCls}>
            Age restriction
          </label>
          <select
            id="age-restriction"
            value={formState.ageRestriction}
            onChange={(e) => update("ageRestriction", e.target.value)}
            disabled={isSaving}
            className={inputCls}
          >
            <option value="">Not specified</option>
            {AGE_RESTRICTION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Reservation Recommendation */}
        <div>
          <label htmlFor="reservation-recommendation" className={labelOptCls}>
            Reservations
          </label>
          <select
            id="reservation-recommendation"
            value={formState.reservationRecommendation}
            onChange={(e) => update("reservationRecommendation", e.target.value)}
            disabled={isSaving}
            className={inputCls}
          >
            <option value="">Not specified</option>
            {RESERVATION_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Parking Notes */}
        <div>
          <label htmlFor="parking-notes" className={labelOptCls}>
            Parking notes
          </label>
          <input
            id="parking-notes"
            type="text"
            value={formState.parkingNotes}
            onChange={(e) => update("parkingNotes", e.target.value)}
            placeholder="e.g. Free parking after 6 PM"
            disabled={isSaving}
            className={inputCls}
          />
        </div>

        {/* Accessibility Notes */}
        <div>
          <label htmlFor="accessibility-notes" className={labelOptCls}>
            Accessibility notes
          </label>
          <input
            id="accessibility-notes"
            type="text"
            value={formState.accessibilityNotes}
            onChange={(e) => update("accessibilityNotes", e.target.value)}
            placeholder="e.g. Wheelchair accessible · Elevator available"
            disabled={isSaving}
            className={inputCls}
          />
        </div>
      </div>

      {/* ── Section 5: Publishing ────────────────────────────────────────── */}
      <div className="pt-5 border-t border-gray-100 space-y-4">
        <h3 className={sectionHeadingCls}>Publishing</h3>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={formState.isPublished}
              onClick={() => {
                if (!formState.isPublished && !formState.eventType) {
                  setPublishError("Please select an event type before publishing.");
                  return;
                }
                if (!formState.isPublished && !imageUrl) {
                  setPublishError("You must add an event image before publishing.");
                  return;
                }
                setPublishError(null);
                update("isPublished", !formState.isPublished);
              }}
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
          {publishError && (
            <p className="text-sm text-red-600">{publishError}</p>
          )}
        </div>

        {/* Save button + badge */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving…" : "Save changes"}
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
      </div>
    </form>
  );
}
