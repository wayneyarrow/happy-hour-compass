/**
 * Server-side event data helper for the consumer app.
 *
 * getEventsForConsumerVenues() fetches published events for a set of venue
 * UUIDs and maps each row to a ConsumerEvent with a human-readable schedule
 * label that matches the tone of the static HTML consumer app.
 */

import { createAdminClient } from "@/lib/supabase/server";

// ─────────────────────────────────────────────────────────────────────────────
// Public type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The event shape consumed by the consumer UI.
 *
 * venueId mirrors the venue UUID from the DB — used internally by
 * getPublishedVenuesForConsumer to group events onto each venue.
 * The consumer UI accesses events through venue.events[], so venueId
 * is rarely accessed directly by UI code.
 */
export type ConsumerEvent = {
  id: string;
  /** Venue UUID — used for grouping, matches venues.id in the DB */
  venueId: string;
  title: string;
  description: string | null;
  /**
   * Human-readable schedule label.
   * Examples: "Wednesdays 5:00 PM–7:00 PM", "Daily 3:00–6:00 PM",
   *           "Jan 15 7:00–9:00 PM", "Every two Fridays 6:00–8:00 PM"
   */
  nextOccurrenceLabel: string;
};

/**
 * Full event detail shape for the consumer event detail page.
 * Includes venue context needed to render the page and link back.
 */
export type ConsumerEventDetail = {
  id: string;
  title: string;
  description: string | null;
  nextOccurrenceLabel: string;
  /** Hero image URL from events.image_url (nullable). */
  imageUrl: string | null;
  /** Venue UUID — matches venues.id; used for the /venue/[id] back-link. */
  venueId: string;
  venueName: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — occurrence label builder
// ─────────────────────────────────────────────────────────────────────────────

/** Joins a start/end time pair with an en dash, or returns just start. */
function formatTimeRange(start: string | null, end: string | null): string {
  if (!start) return "";
  return end ? `${start}–${end}` : start;
}

const DAYS_PLURAL = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
] as const;

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Parses a "YYYY-MM-DD" ISO string using UTC so the result is identical
 * regardless of the server's local timezone.
 */
function parseIsoDate(
  iso: string
): { month: number; day: number; dow: number } | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1; // 0-indexed for Date ctor
  const day = parseInt(m[3], 10);
  const dow = new Date(Date.UTC(year, month, day)).getUTCDay();
  return { month, day, dow };
}

type ScheduleRow = {
  first_date: string | null;
  start_time: string | null;
  end_time: string | null;
  recurrence: string | null;
  event_time: string | null;
  event_frequency: string | null;
};

/**
 * Builds a human-readable occurrence label from a Supabase event row.
 *
 * Priority:
 *   1. Structured fields: first_date + recurrence + start_time/end_time
 *   2. Legacy plain-text fields: event_frequency + event_time
 */
function buildOccurrenceLabel(row: ScheduleRow): string {
  const timeRange = formatTimeRange(row.start_time, row.end_time);
  const recurrence = row.recurrence ?? "none";

  if (recurrence === "daily") {
    return timeRange ? `Daily ${timeRange}` : "Daily";
  }

  if (recurrence === "weekly") {
    if (row.first_date) {
      const parsed = parseIsoDate(row.first_date);
      if (parsed) {
        const dayName = DAYS_PLURAL[parsed.dow];
        return timeRange ? `${dayName} ${timeRange}` : dayName;
      }
    }
    return timeRange ? `Weekly ${timeRange}` : "Weekly";
  }

  if (recurrence === "biweekly") {
    if (row.first_date) {
      const parsed = parseIsoDate(row.first_date);
      if (parsed) {
        const dayName = DAYS_PLURAL[parsed.dow];
        return timeRange
          ? `Every two ${dayName} ${timeRange}`
          : `Every two ${dayName}`;
      }
    }
    return timeRange ? `Every two weeks ${timeRange}` : "Every two weeks";
  }

  if (recurrence === "monthly") {
    return timeRange ? `Monthly ${timeRange}` : "Monthly";
  }

  // recurrence === "none" or unrecognized — one-off or legacy
  if (row.first_date) {
    const parsed = parseIsoDate(row.first_date);
    if (parsed) {
      const dateLabel = `${MONTHS_SHORT[parsed.month]} ${parsed.day}`;
      return timeRange ? `${dateLabel} ${timeRange}` : dateLabel;
    }
  }

  // Fallback: legacy plain-text fields from older data / CSV imports
  const legacyParts = [row.event_frequency, row.event_time].filter(Boolean);
  return legacyParts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches a single event by UUID for the consumer event detail page.
 *
 * In normal mode only published events are returned. In preview mode
 * (includeUnpublished = true) unpublished events are also returned.
 *
 * Returns null on any error or when the event is not found.
 */
export async function getEventForConsumerById(
  id: string,
  options?: { includeUnpublished?: boolean }
): Promise<ConsumerEventDetail | null> {
  try {
    const supabase = createAdminClient();

    let query = supabase
      .from("events")
      .select(
        "id, venue_id, title, description, image_url, " +
          "first_date, start_time, end_time, recurrence, " +
          "event_time, event_frequency"
      )
      .eq("id", id);

    if (!options?.includeUnpublished) {
      query = query.eq("is_published", true);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (query as any).maybeSingle();

    if (error) {
      console.error("[getEventForConsumerById] Supabase error:", error);
      return null;
    }

    if (!data) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = data as Record<string, any>;
    const venueId = row.venue_id as string;

    // Fetch the venue name for context display and back-link.
    const { data: venueRow } = await supabase
      .from("venues")
      .select("name")
      .eq("id", venueId)
      .maybeSingle();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const venueName = ((venueRow as Record<string, any> | null)?.name as string) ?? "";

    return {
      id: row.id as string,
      title: (row.title as string) ?? "",
      description: (row.description as string | null) ?? null,
      nextOccurrenceLabel: buildOccurrenceLabel({
        first_date: row.first_date as string | null,
        start_time: row.start_time as string | null,
        end_time: row.end_time as string | null,
        recurrence: row.recurrence as string | null,
        event_time: row.event_time as string | null,
        event_frequency: row.event_frequency as string | null,
      }),
      imageUrl: (row.image_url as string | null) ?? null,
      venueId,
      venueName,
    };
  } catch (err) {
    console.error("[getEventForConsumerById] Unexpected error:", err);
    return null;
  }
}

/**
 * Fetches published events for the given venue UUIDs.
 *
 * Uses the service-role admin client to bypass RLS — same rationale as
 * getPublishedVenuesForConsumer: the consumer app has no authenticated session.
 *
 * Returns an empty array on any error so the caller never hard-crashes.
 */
export async function getEventsForConsumerVenues(
  venueIds: string[]
): Promise<ConsumerEvent[]> {
  if (venueIds.length === 0) return [];

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("events")
      .select(
        "id, venue_id, title, description, " +
          "first_date, start_time, end_time, recurrence, " +
          "event_time, event_frequency"
      )
      .in("venue_id", venueIds)
      .eq("is_published", true)
      .order("first_date", { ascending: true })
      .order("title", { ascending: true });

    if (error) {
      console.error("[getEventsForConsumerVenues] Supabase error:", error);
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((row: Record<string, any>) => ({
      id: row.id as string,
      venueId: row.venue_id as string,
      title: (row.title as string) ?? "",
      description: (row.description as string | null) ?? null,
      nextOccurrenceLabel: buildOccurrenceLabel({
        first_date: row.first_date as string | null,
        start_time: row.start_time as string | null,
        end_time: row.end_time as string | null,
        recurrence: row.recurrence as string | null,
        event_time: row.event_time as string | null,
        event_frequency: row.event_frequency as string | null,
      }),
    }));
  } catch (err) {
    console.error("[getEventsForConsumerVenues] Unexpected error:", err);
    return [];
  }
}
