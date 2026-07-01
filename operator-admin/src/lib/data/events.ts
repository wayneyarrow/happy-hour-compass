/**
 * Server-side event data helper for the consumer app and public website.
 *
 * getEventsForConsumerVenues() fetches published events for a set of venue
 * UUIDs and maps each row to a ConsumerEvent with a human-readable schedule
 * label that matches the tone of the static HTML consumer app.
 *
 * getPublishedEventsForWebsite() fetches market-scoped published events for
 * the website Events Search Results page.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { haversineKm } from "@/lib/discover/discoverEngine";
import { toMarketConfig, type Market } from "@/lib/markets";

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
  /** Event category key — matches EventTypeKey in src/lib/eventTypes.ts. */
  eventType: string | null;
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
  /** Event category key — matches EventTypeKey in src/lib/eventTypes.ts. */
  eventType: string | null;
  /** Hero image URL from events.image_url (nullable). */
  imageUrl: string | null;
  /** Venue UUID — matches venues.id; used for the /venue/[id] back-link. */
  venueId: string;
  venueName: string;
  // Venue context — drives action buttons and venue info rows on the detail page.
  venueAddress: string;
  venuePhone: string;
  venueWebsiteUrl: string;
  venueMenuUrl: string;
  venuePaymentMethods: string;
  /** Business hours keyed by day name — "H:MM AM – H:MM PM" or "CLOSED". */
  venueHoursWeekly: Record<string, string>;
  /** When true, a ticket purchase link is active for this event. */
  ticketingEnabled: boolean;
  /** URL for purchasing tickets. Only meaningful when ticketingEnabled = true. */
  ticketUrl: string | null;
  /** When true (and ticketingEnabled), consumer UI shows "Sold Out" instead of a ticket link. */
  soldOut: boolean;
  /** Platform-created content flag — true for all events seeded before migration 049. */
  isSeededEvent: boolean;
  // Premium landing page fields (migration 050)
  priceDisplay: string | null;
  ageRestriction: string | null;
  reservationRecommendation: string | null;
  parkingNotes: string | null;
  accessibilityNotes: string | null;
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

// ─── Venue context helpers ────────────────────────────────────────────────────

const EVENT_VENUE_DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;
type EventVenueDay = (typeof EVENT_VENUE_DAYS)[number];

/** Converts "HH:MM" 24-hour string to display format like "4 PM" or "4:30 PM". */
function hhmmTo12hDisplay(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${mStr} ${ampm}`;
}

/** Maps the business_hours JSONB column to a day → display-string record. */
function mapDbHours(
  raw: Record<string, { open: string; close: string } | null> | null
): Record<string, string> {
  const weekly: Record<string, string> = {};
  EVENT_VENUE_DAYS.forEach((d) => {
    weekly[d] = "CLOSED";
  });
  if (!raw) return weekly;
  for (const [dayLower, slot] of Object.entries(raw)) {
    const day = (dayLower.charAt(0).toUpperCase() + dayLower.slice(1)) as EventVenueDay;
    if (!EVENT_VENUE_DAYS.includes(day)) continue;
    weekly[day] = slot
      ? `${hhmmTo12hDisplay(slot.open)} \u2013 ${hhmmTo12hDisplay(slot.close)}`
      : "CLOSED";
  }
  return weekly;
}

/** Parses the payment_types TEXT column (stored as JSON array) to a comma string. */
function parsePaymentTypesStr(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]).join(", ") : String(raw);
  } catch {
    return String(raw);
  }
}

// ─── Happy Hour parsing helpers (private to this file) ───────────────────────
// Mirrors the logic in venues.ts to avoid a circular import.

type HhSlot = { start: string; end: string };

const HH_DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;
type HhDay = (typeof HH_DAYS)[number];

function hhParse12hToHHMM(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (t === "close" || t === "closing") return "23:00";
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === "pm" && h !== 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}

function hhExpandDayRange(dayPart: string): HhDay[] {
  const t = dayPart.trim();
  if (/^(daily|everyday)$/i.test(t)) return [...HH_DAYS];
  if (/^weekdays?$/i.test(t)) return HH_DAYS.filter((d) => d !== "Saturday" && d !== "Sunday");
  const rangeMatch = t.match(/^(.+?)\s*[–\-]\s*(.+)$/);
  if (!rangeMatch) {
    const found = HH_DAYS.find((d) => d.toLowerCase().startsWith(t.toLowerCase().substring(0, 3)));
    return found ? [found] : [];
  }
  const startAbbr = rangeMatch[1].trim().toLowerCase().substring(0, 3);
  const endAbbr = rangeMatch[2].trim().toLowerCase().substring(0, 3);
  const startIdx = HH_DAYS.findIndex((d) => d.toLowerCase().startsWith(startAbbr));
  const endIdx = HH_DAYS.findIndex((d) => d.toLowerCase().startsWith(endAbbr));
  if (startIdx === -1 || endIdx === -1) return [];
  const result: HhDay[] = [];
  let i = startIdx;
  for (;;) {
    result.push(HH_DAYS[i]);
    if (i === endIdx) break;
    i = (i + 1) % HH_DAYS.length;
  }
  return result;
}

function hhExpandScraperCompact(text: string): string {
  const blocks = text.split("|").map((b) => b.trim());
  const dayGroups: HhDay[][] = [
    ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"],
    ["Friday", "Saturday"],
  ];
  const lines: string[] = [];
  blocks.forEach((block, i) => {
    if (i >= dayGroups.length) return;
    const slots = block.split("&").map((s) => s.trim()).join(", ");
    for (const day of dayGroups[i]) lines.push(`${day}: ${slots}`);
  });
  return lines.join("\n");
}

function hhExpandScraperGrouped(text: string): string {
  const lines: string[] = [];
  for (const block of text.split("|").map((b) => b.trim())) {
    const colonIdx = block.indexOf(":");
    if (colonIdx === -1) continue;
    const daySpec = block.substring(0, colonIdx).trim();
    const slots = block.substring(colonIdx + 1).trim().split("&").map((s) => s.trim()).join(", ");
    for (const part of daySpec.split("&").map((s) => s.trim())) {
      for (const day of hhExpandDayRange(part)) lines.push(`${day}: ${slots}`);
    }
  }
  return lines.join("\n");
}

function parseHhTimesForWebsite(text: string | null): Record<string, HhSlot[]> {
  const weekly: Record<string, HhSlot[]> = {};
  HH_DAYS.forEach((d) => { weekly[d] = []; });
  if (!text?.trim()) return weekly;

  text = text.replace(/[    ]/g, " ").replace(/\r/g, "").trim();

  if (!text.includes("\n") && text.includes("|")) {
    const firstBlock = text.split("|")[0].trim();
    if (/^(sun|mon|tue|wed|thu|fri|sat|daily|everyday|weekday)/i.test(firstBlock)) {
      text = hhExpandScraperGrouped(text);
    } else {
      text = hhExpandScraperCompact(text);
    }
  }

  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    let splitIdx = -1;
    for (let j = 0; j < line.length; j++) {
      if (line[j] === ":") {
        const before = line.substring(0, j).trim();
        const after = line.substring(j + 1).trim();
        if (/\d$/.test(before) && /^\d/.test(after)) continue;
        splitIdx = j;
        break;
      }
    }
    if (splitIdx === -1) continue;
    const dayPart = line.substring(0, splitIdx).trim();
    const timePart = line.substring(splitIdx + 1).trim();
    if (!timePart || /^no\b/i.test(timePart)) continue;
    const days = hhExpandDayRange(dayPart);
    for (const slotStr of timePart.split(/[,&]/).map((s) => s.trim()).filter(Boolean)) {
      const m = slotStr.match(/^(.+?)\s*[–\-]\s*(.+)$/);
      if (!m) continue;
      const rawStart = m[1].trim();
      const rawEnd = m[2].trim();
      const startForParse = /\s*(am|pm)\s*$/i.test(rawStart)
        ? rawStart
        : (() => { const p = rawEnd.match(/\s*(am|pm)\s*$/i)?.[1]; return p ? `${rawStart} ${p}` : rawStart; })();
      const start = hhParse12hToHHMM(startForParse);
      const end = hhParse12hToHHMM(rawEnd);
      if (start && end) {
        for (const day of days) weekly[day].push({ start, end });
      }
    }
  }
  return weekly;
}

/** Returns the count of items in hh_food_details / hh_drink_details raw columns. */
function countSpecialsItems(raw: string | null): number {
  if (!raw?.trim()) return 0;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.filter((x) => x != null && x !== "").length;
  } catch { /* fall through */ }
  const delimiter = raw.includes("|") ? "|" : "\n";
  return raw.split(delimiter).filter((s) => s.trim()).length;
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
        "id, venue_id, title, description, event_type, image_url, " +
          "first_date, start_time, end_time, recurrence, " +
          "event_time, event_frequency, " +
          "ticketing_enabled, ticket_url, sold_out, is_seeded_event, " +
          "price_display, age_restriction, reservation_recommendation, parking_notes, accessibility_notes"
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

    // Fetch venue context for detail page rendering (action buttons + info rows).
    const { data: venueRow } = await supabase
      .from("venues")
      .select(
        "name, address_line1, phone, website_url, menu_url, payment_types, business_hours"
      )
      .eq("id", venueId)
      .maybeSingle();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vr = (venueRow as Record<string, any> | null) ?? {};

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
      eventType: (row.event_type as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
      venueId,
      venueName: (vr.name as string) ?? "",
      venueAddress: (vr.address_line1 as string) ?? "",
      venuePhone: (vr.phone as string) ?? "",
      venueWebsiteUrl: (vr.website_url as string) ?? "",
      venueMenuUrl: (vr.menu_url as string) ?? "",
      venuePaymentMethods: parsePaymentTypesStr(vr.payment_types as string | null),
      venueHoursWeekly: mapDbHours(
        vr.business_hours as Record<string, { open: string; close: string } | null> | null
      ),
      ticketingEnabled: row.ticketing_enabled === true,
      ticketUrl: (row.ticket_url as string | null) ?? null,
      soldOut: row.sold_out === true,
      isSeededEvent: row.is_seeded_event === true,
      priceDisplay: (row.price_display as string | null) ?? null,
      ageRestriction: (row.age_restriction as string | null) ?? null,
      reservationRecommendation: (row.reservation_recommendation as string | null) ?? null,
      parkingNotes: (row.parking_notes as string | null) ?? null,
      accessibilityNotes: (row.accessibility_notes as string | null) ?? null,
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
        "id, venue_id, title, description, event_type, " +
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

    const today = new Date().toISOString().slice(0, 10);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).filter((row: Record<string, any>) => {
      const isRecurring = row.recurrence && row.recurrence !== "none";
      return isRecurring || !row.first_date || (row.first_date as string) >= today;
    }).map((row: Record<string, any>) => ({
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
      eventType: (row.event_type as string | null) ?? null,
    }));
  } catch (err) {
    console.error("[getEventsForConsumerVenues] Unexpected error:", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Events discovery
// ─────────────────────────────────────────────────────────────────────────────

/** Shape returned for each event on the consumer /events discovery page. */
export type ConsumerEventListItem = {
  id: string;
  title: string;
  description: string | null;
  nextOccurrenceLabel: string;
  /** Event category key — matches EventTypeKey in src/lib/eventTypes.ts. */
  eventType: string | null;
  imageUrl: string | null;
  /** Venue UUID — used for grouping and linking. */
  venueId: string;
  venueName: string;
  /** ISO date string "YYYY-MM-DD" — used by client-side date filters. */
  firstDate: string | null;
  /** Recurrence pattern — recurring events pass all date filters. */
  recurrence: string | null;
};

/**
 * Returns 0 (upcoming), 1 (past), or 2 (undated) for sorting.
 *
 * Recurring events are always treated as upcoming because they continue to
 * fire regardless of when first_date falls. One-off events (recurrence "none"
 * or absent) are past when first_date < today.
 */
function upcomingBucket(
  firstDate: string | null,
  recurrence: string | null,
  today: string
): 0 | 1 | 2 {
  if (!firstDate) return 2;
  const isRecurring = recurrence && recurrence !== "none";
  if (isRecurring || firstDate >= today) return 0;
  return 1;
}

/**
 * Fetches all published events for the consumer events discovery page.
 *
 * Joins the parent venue to include the venue name alongside each event.
 * Sorts in application code so that upcoming events appear first (soonest to
 * farthest), followed by past one-off events, then undated events last.
 * Recurring events are always treated as upcoming. Returns an empty array on
 * any error.
 */
export async function getPublishedEventsForConsumer(): Promise<
  ConsumerEventListItem[]
> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("events")
      .select(
        "id, venue_id, title, description, event_type, image_url, " +
          "first_date, start_time, end_time, recurrence, " +
          "event_time, event_frequency, " +
          "venues(name)"
      )
      .eq("is_published", true)
      .order("title", { ascending: true });

    if (error) {
      console.error("[getPublishedEventsForConsumer] Supabase error:", error);
      return [];
    }

    const today = new Date().toISOString().slice(0, 10);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allRows = (data ?? []) as Record<string, any>[];

    // Exclude past one-off events (bucket 1). Recurring events always show.
    const rows = allRows.filter(
      (row) => upcomingBucket(row.first_date, row.recurrence, today) !== 1
    );

    rows.sort((a, b) => {
      const bA = upcomingBucket(a.first_date, a.recurrence, today);
      const bB = upcomingBucket(b.first_date, b.recurrence, today);
      if (bA !== bB) return bA - bB;

      if (bA === 0) {
        // Upcoming: soonest first; undated recurring after dated upcoming
        const dA = a.first_date as string | null;
        const dB = b.first_date as string | null;
        if (dA && dB && dA !== dB) return dA < dB ? -1 : 1;
        if (dA && !dB) return -1;
        if (!dA && dB) return 1;
      } else if (bA === 1) {
        // Past: most recent first
        const dA = a.first_date as string;
        const dB = b.first_date as string;
        if (dA !== dB) return dA < dB ? 1 : -1;
      }

      // Tie-break: title alphabetical (already DB-sorted)
      return 0;
    });

    return rows.map((row: Record<string, any>) => ({
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
      eventType: (row.event_type as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
      venueId: row.venue_id as string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      venueName:
        ((row.venues as Record<string, any> | null)?.name as string) ?? "",
      firstDate: (row.first_date as string | null) ?? null,
      recurrence: (row.recurrence as string | null) ?? null,
    }));
  } catch (err) {
    console.error("[getPublishedEventsForConsumer] Unexpected error:", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Control Panel — Featured Events rail candidates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full event shape needed by the CP Discover Management Featured Events rail.
 * Includes venue context (for display and eligibility checks) and event-level
 * discover controls added in migration 038.
 */
export type CPFeaturedEventItem = {
  /** events.id — UUID primary key */
  eventUuid: string;
  title: string;
  nextOccurrenceLabel: string;
  /** ISO "YYYY-MM-DD" or null. Used for upcoming-only filtering. */
  firstDate: string | null;
  /** Recurrence pattern. Recurring events are always treated as upcoming. */
  recurrence: string | null;
  /** Event-level ranking boost (0–100). From events.internal_boost. */
  internalBoost: number;
  /** When true, this event is hidden from all discover rails. */
  excludeFromDiscover: boolean;
  /** venues.id — UUID used for DB mutations (not the slug). */
  venueUuid: string;
  /** venues.slug — used for CP venue detail links (/control-panel/venues/:slug). */
  venueSlug: string;
  venueName: string;
  /** venues.exclude_from_discover — venue-wide suppress flag. */
  venueExcludeFromDiscover: boolean;
  venueLat: number | null;
  venueLng: number | null;
  operatorPlan: "free" | "pro" | "premium" | "enterprise";
};

/**
 * Fetches all published events with venue context for the CP Featured Events
 * Discover Management rail.  Includes upcoming-only filtering (past one-off
 * events are excluded; recurring events are always included).
 *
 * Uses the admin client (service-role) to bypass RLS.
 * Returns an empty array on any error.
 */
export async function getCPFeaturedEventCandidates(): Promise<CPFeaturedEventItem[]> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("events")
      .select(
        "id, venue_id, title, " +
          "first_date, start_time, end_time, recurrence, " +
          "event_time, event_frequency, " +
          "internal_boost, exclude_from_discover, " +
          "venues!venue_id(" +
            "id, slug, name, lat, lng, exclude_from_discover, " +
            "operators!created_by_operator_id(plan)" +
          ")"
      )
      .eq("is_published", true)
      .order("title", { ascending: true });

    if (error) {
      console.error("[getCPFeaturedEventCandidates] Supabase error:", error);
      return [];
    }

    const today = new Date().toISOString().slice(0, 10);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).flatMap((row: Record<string, any>) => {
      const firstDate  = (row.first_date as string | null) ?? null;
      const recurrence = (row.recurrence as string | null) ?? null;

      // Filter out past one-off events (same logic as upcomingBucket)
      if (upcomingBucket(firstDate, recurrence, today) === 1) return [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const venue = (row.venues as Record<string, any> | null) ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const operator = (venue.operators as Record<string, any> | null) ?? null;
      const rawPlan = operator?.plan as string | undefined;
      const plan: CPFeaturedEventItem["operatorPlan"] =
        rawPlan === "pro" || rawPlan === "premium" || rawPlan === "enterprise"
          ? rawPlan
          : "free";

      return [{
        eventUuid:              row.id as string,
        title:                  (row.title as string) ?? "",
        nextOccurrenceLabel:    buildOccurrenceLabel({
          first_date:      firstDate,
          start_time:      (row.start_time as string | null) ?? null,
          end_time:        (row.end_time as string | null) ?? null,
          recurrence,
          event_time:      (row.event_time as string | null) ?? null,
          event_frequency: (row.event_frequency as string | null) ?? null,
        }),
        firstDate,
        recurrence,
        internalBoost:          typeof row.internal_boost === "number" ? row.internal_boost : 0,
        excludeFromDiscover:    row.exclude_from_discover === true,
        venueUuid:              (venue.id as string) ?? "",
        venueSlug:              (venue.slug as string) ?? "",
        venueName:              (venue.name as string) ?? "",
        venueExcludeFromDiscover: venue.exclude_from_discover === true,
        venueLat:               typeof venue.lat === "number" ? venue.lat : null,
        venueLng:               typeof venue.lng === "number" ? venue.lng : null,
        operatorPlan:           plan,
      }];
    });
  } catch (err) {
    console.error("[getCPFeaturedEventCandidates] Unexpected error:", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Website Events Search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Event shape for the public website Events Search Results page.
 * Includes venue context needed to show venue name, type, and market filtering.
 */
export type WebsiteEventListItem = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  /** Event category key — matches EventTypeKey in src/lib/eventTypes.ts. */
  eventType: string | null;
  venueName: string;
  venueEstablishmentType: string;
  venueLat: number | null;
  venueLng: number | null;
  /** ISO "YYYY-MM-DD" — null for undated recurring events. */
  firstDate: string | null;
  /** Recurrence pattern — "none" | "daily" | "weekly" | "biweekly" | "monthly". */
  recurrence: string | null;
  /** 24-hour "HH:MM" start time — null if not specified. */
  startTime: string | null;
  /** Human-readable occurrence label, e.g. "Fridays 8:00–10:00 PM". */
  nextOccurrenceLabel: string;
};

/**
 * Fetches published events for the website Events Search Results page.
 *
 * Scoped to the active market via Haversine distance filtering on venue lat/lng.
 * Venues without coordinates are included permissively (assumed local).
 * Past one-off events are excluded; recurring events are always included.
 * Uses the service-role admin client to bypass RLS.
 */
export async function getPublishedEventsForWebsite(
  market: Market
): Promise<WebsiteEventListItem[]> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("events")
      .select(
        "id, venue_id, title, description, event_type, image_url, " +
          "first_date, start_time, end_time, recurrence, " +
          "event_time, event_frequency, " +
          "venues(name, lat, lng, establishment_type)"
      )
      .eq("is_published", true)
      .order("first_date", { ascending: true, nullsFirst: false })
      .order("title", { ascending: true });

    if (error) {
      console.error("[getPublishedEventsForWebsite] Supabase error:", error);
      return [];
    }

    const today = new Date().toISOString().slice(0, 10);
    const { lat: mLat, lng: mLng, radiusKm } = toMarketConfig(market);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).flatMap((row: Record<string, any>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const venue = (row.venues as Record<string, any> | null) ?? {};
      const vLat = typeof venue.lat === "number" ? venue.lat : null;
      const vLng = typeof venue.lng === "number" ? venue.lng : null;

      // Market filter — exclude venues that have real coordinates outside the market.
      // (0, 0) is treated as "no coordinates": it lies in the Gulf of Guinea and is
      // impossible for any HHC venue; treating it as null keeps permissive behaviour
      // for venues whose lat/lng were never properly populated.
      const hasRealCoordinates =
        vLat !== null && vLng !== null && !(vLat === 0 && vLng === 0);
      if (hasRealCoordinates && haversineKm(mLat, mLng, vLat!, vLng!) > radiusKm) {
        return [];
      }

      const firstDate = (row.first_date as string | null) ?? null;
      const recurrence = (row.recurrence as string | null) ?? null;

      // Exclude past one-off events (same logic as upcomingBucket === 1)
      const isRecurring = recurrence && recurrence !== "none";
      if (!isRecurring && firstDate && firstDate < today) return [];

      return [
        {
          id: row.id as string,
          title: (row.title as string) ?? "",
          description: (row.description as string | null) ?? null,
          imageUrl: (row.image_url as string | null) ?? null,
          eventType: (row.event_type as string | null) ?? null,
          venueName: (venue.name as string) ?? "",
          venueEstablishmentType: (venue.establishment_type as string) ?? "",
          venueLat: vLat,
          venueLng: vLng,
          firstDate,
          recurrence,
          startTime: (row.start_time as string | null) ?? null,
          nextOccurrenceLabel: buildOccurrenceLabel({
            first_date: firstDate,
            start_time: (row.start_time as string | null) ?? null,
            end_time: (row.end_time as string | null) ?? null,
            recurrence,
            event_time: (row.event_time as string | null) ?? null,
            event_frequency: (row.event_frequency as string | null) ?? null,
          }),
        },
      ];
    });
  } catch (err) {
    console.error("[getPublishedEventsForWebsite] Unexpected error:", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Website Event Detail Page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full event + venue shape for the public website Event Detail page.
 * Fetched in a single data call; avoids circular dependency with venues.ts
 * by querying the venue table directly.
 */
export type WebsiteEventDetail = {
  // Event
  id: string;
  title: string;
  description: string | null;
  nextOccurrenceLabel: string;
  eventType: string | null;
  imageUrl: string | null;
  firstDate: string | null;
  recurrence: string | null;
  startTime: string | null;
  endTime: string | null;
  ticketingEnabled: boolean;
  ticketUrl: string | null;
  soldOut: boolean;
  isSeededEvent: boolean;
  /** True when this is a one-off event whose first_date is in the past. */
  isExpired: boolean;
  // Premium landing page fields (migration 050)
  priceDisplay: string | null;
  ageRestriction: string | null;
  reservationRecommendation: string | null;
  parkingNotes: string | null;
  accessibilityNotes: string | null;
  // Venue context
  venueId: string;
  venueSlug: string;
  venueName: string;
  venueAddress: string;
  venuePhone: string;
  venueWebsiteUrl: string;
  venueMenuUrl: string;
  venuePaymentMethods: string;
  venueHoursWeekly: Record<string, string>;
  venueLat: number | null;
  venueLng: number | null;
  venueEstablishmentType: string;
  venueAbout: string | null;
  venueGoogleRating: number | null;
  venueGoogleReviewCount: number | null;
  venueHhTagline: string;
  venueHhWeekly: Record<string, Array<{ start: string; end: string }>>;
  venueSpecialsFoodCount: number;
  venueSpecialsDrinksCount: number;
  venueImages: Array<{ url: string }>;
  // Related events
  otherEvents: Array<{
    id: string;
    title: string;
    nextOccurrenceLabel: string;
    eventType: string | null;
  }>;
};

/**
 * Fetches a published event plus extended venue context for the website
 * Event Detail page.  Queries the venue table directly to avoid a circular
 * import with venues.ts (which imports from events.ts).
 *
 * Returns null when the event is not found or is not published.
 */
export async function getEventForWebsite(
  id: string
): Promise<WebsiteEventDetail | null> {
  try {
    const supabase = createAdminClient();

    // ── Event row ────────────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: eventData, error: eventError } = await (supabase
      .from("events")
      .select(
        "id, venue_id, title, description, event_type, image_url, " +
          "first_date, start_time, end_time, recurrence, " +
          "event_time, event_frequency, " +
          "ticketing_enabled, ticket_url, sold_out, is_seeded_event, " +
          "price_display, age_restriction, reservation_recommendation, parking_notes, accessibility_notes"
      )
      .eq("id", id)
      .eq("is_published", true)
      .maybeSingle() as unknown as Promise<{ data: unknown; error: unknown }>);

    if (eventError) {
      console.error("[getEventForWebsite] Event fetch error:", eventError);
      return null;
    }
    if (!eventData) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = eventData as Record<string, any>;
    const venueId = row.venue_id as string;

    const firstDate = (row.first_date as string | null) ?? null;
    const recurrence = (row.recurrence as string | null) ?? null;
    const today = new Date().toISOString().slice(0, 10);
    const isRecurring = recurrence && recurrence !== "none";
    const isExpired = !isRecurring && firstDate !== null && firstDate < today;

    // ── Venue, other events, and venue images — parallel ─────────────────────
    const [venueResult, otherEventsResult, imagesResult] = await Promise.all([
      supabase
        .from("venues")
        .select(
          "id, slug, name, address_line1, phone, website_url, menu_url, " +
            "payment_types, business_hours, lat, lng, establishment_type, " +
            "about_your_venue, google_rating, google_review_count, hh_tagline, " +
            "hh_times, hh_food_details, hh_drink_details"
        )
        .eq("id", venueId)
        .maybeSingle(),
      supabase
        .from("events")
        .select(
          "id, title, event_type, " +
            "first_date, start_time, end_time, recurrence, " +
            "event_time, event_frequency"
        )
        .eq("venue_id", venueId)
        .eq("is_published", true)
        .neq("id", id)
        .order("first_date", { ascending: true, nullsFirst: false })
        .order("title", { ascending: true }),
      supabase
        .from("media")
        .select("url")
        .eq("venue_id", venueId)
        .eq("type", "venue_image")
        .order("sort_order", { ascending: true }),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vr = (venueResult.data as Record<string, any> | null) ?? {};

    // Filter other events to upcoming only, limit for display.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawOther = ((otherEventsResult.data ?? []) as Record<string, any>[])
      .filter((e) => {
        const rec = e.recurrence as string | null;
        const fd = e.first_date as string | null;
        return (rec && rec !== "none") || !fd || fd >= today;
      })
      .slice(0, 6);

    return {
      id: row.id as string,
      title: (row.title as string) ?? "",
      description: (row.description as string | null) ?? null,
      nextOccurrenceLabel: buildOccurrenceLabel({
        first_date: firstDate,
        start_time: (row.start_time as string | null) ?? null,
        end_time: (row.end_time as string | null) ?? null,
        recurrence,
        event_time: (row.event_time as string | null) ?? null,
        event_frequency: (row.event_frequency as string | null) ?? null,
      }),
      eventType: (row.event_type as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
      firstDate,
      recurrence,
      startTime: (row.start_time as string | null) ?? null,
      endTime: (row.end_time as string | null) ?? null,
      ticketingEnabled: row.ticketing_enabled === true,
      ticketUrl: (row.ticket_url as string | null) ?? null,
      soldOut: row.sold_out === true,
      isSeededEvent: row.is_seeded_event === true,
      isExpired,
      priceDisplay: (row.price_display as string | null) ?? null,
      ageRestriction: (row.age_restriction as string | null) ?? null,
      reservationRecommendation: (row.reservation_recommendation as string | null) ?? null,
      parkingNotes: (row.parking_notes as string | null) ?? null,
      accessibilityNotes: (row.accessibility_notes as string | null) ?? null,
      venueId,
      venueSlug: (vr.slug as string) ?? "",
      venueName: (vr.name as string) ?? "",
      venueAddress: (vr.address_line1 as string) ?? "",
      venuePhone: (vr.phone as string) ?? "",
      venueWebsiteUrl: (vr.website_url as string) ?? "",
      venueMenuUrl: (vr.menu_url as string) ?? "",
      venuePaymentMethods: parsePaymentTypesStr(vr.payment_types as string | null),
      venueHoursWeekly: mapDbHours(
        vr.business_hours as Record<string, { open: string; close: string } | null> | null
      ),
      venueLat: typeof vr.lat === "number" ? vr.lat : null,
      venueLng: typeof vr.lng === "number" ? vr.lng : null,
      venueEstablishmentType: (vr.establishment_type as string) ?? "",
      venueAbout: (vr.about_your_venue as string | null) ?? null,
      venueGoogleRating: typeof vr.google_rating === "number" ? vr.google_rating : null,
      venueGoogleReviewCount:
        typeof vr.google_review_count === "number" ? vr.google_review_count : null,
      venueHhTagline: (vr.hh_tagline as string) ?? "",
      venueHhWeekly: parseHhTimesForWebsite(vr.hh_times as string | null),
      venueSpecialsFoodCount: countSpecialsItems(vr.hh_food_details as string | null),
      venueSpecialsDrinksCount: countSpecialsItems(vr.hh_drink_details as string | null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      venueImages: (imagesResult.data ?? []).map((r: Record<string, any>) => ({
        url: r.url as string,
      })),
      otherEvents: rawOther.map((e) => ({
        id: e.id as string,
        title: (e.title as string) ?? "",
        nextOccurrenceLabel: buildOccurrenceLabel({
          first_date: (e.first_date as string | null) ?? null,
          start_time: (e.start_time as string | null) ?? null,
          end_time: (e.end_time as string | null) ?? null,
          recurrence: (e.recurrence as string | null) ?? null,
          event_time: (e.event_time as string | null) ?? null,
          event_frequency: (e.event_frequency as string | null) ?? null,
        }),
        eventType: (e.event_type as string | null) ?? null,
      })),
    };
  } catch (err) {
    console.error("[getEventForWebsite] Unexpected error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved items preview
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal event data needed to render a saved-items dropdown row. */
export type EventPreview = {
  /** Event UUID — matches the ID stored by savedItems.ts. */
  id: string;
  title: string;
  venueName: string;
  imageUrl: string | null;
  nextOccurrenceLabel: string;
};

/**
 * Fetches lightweight preview data for a list of event UUIDs.
 * Used by the Saved dropdown to display saved event rows.
 * IDs that no longer resolve (deleted/unpublished) are omitted silently.
 */
export async function getEventPreviewsByIds(
  eventIds: string[]
): Promise<EventPreview[]> {
  if (eventIds.length === 0) return [];
  try {
    const supabase = createAdminClient();

    const { data: rows, error } = await supabase
      .from("events")
      .select(
        "id, title, image_url, first_date, start_time, end_time, recurrence, " +
          "event_time, event_frequency, venues(name)"
      )
      .in("id", eventIds)
      .eq("is_published", true);

    if (error || !rows || rows.length === 0) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((r: Record<string, any>): EventPreview => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const venue = (r.venues as Record<string, any> | null) ?? {};

      const nextOccurrenceLabel = buildOccurrenceLabel({
        first_date: (r.first_date as string | null) ?? null,
        recurrence: (r.recurrence as string | null) ?? null,
        start_time: (r.start_time as string | null) ?? null,
        end_time: (r.end_time as string | null) ?? null,
        event_time: (r.event_time as string | null) ?? null,
        event_frequency: (r.event_frequency as string | null) ?? null,
      });

      return {
        id: r.id as string,
        title: r.title as string,
        venueName: (venue.name as string) ?? "",
        imageUrl: (r.image_url as string | null) ?? null,
        nextOccurrenceLabel,
      };
    });
  } catch (err) {
    console.error("[getEventPreviewsByIds] Unexpected error:", err);
    return [];
  }
}

/**
 * Fetches published events by their UUIDs.
 * Returns WebsiteEventListItem[] — same shape as getPublishedEventsForWebsite but
 * scoped to specific IDs. Used by the /saved page to load full event data
 * for saved events without fetching the entire market dataset.
 */
export async function getPublishedEventsByIds(
  ids: string[]
): Promise<WebsiteEventListItem[]> {
  if (ids.length === 0) return [];
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("events")
      .select(
        "id, title, description, event_type, image_url, " +
          "first_date, start_time, end_time, recurrence, " +
          "event_time, event_frequency, " +
          "venues(name, lat, lng, establishment_type)"
      )
      .in("id", ids)
      .eq("is_published", true);

    if (error || !data || data.length === 0) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as Record<string, any>[]).map((row): WebsiteEventListItem => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const venue = (row.venues as Record<string, any> | null) ?? {};
      const vLat = typeof venue.lat === "number" ? venue.lat : null;
      const vLng = typeof venue.lng === "number" ? venue.lng : null;
      const firstDate = (row.first_date as string | null) ?? null;
      const recurrence = (row.recurrence as string | null) ?? null;

      return {
        id: row.id as string,
        title: (row.title as string) ?? "",
        description: (row.description as string | null) ?? null,
        imageUrl: (row.image_url as string | null) ?? null,
        eventType: (row.event_type as string | null) ?? null,
        venueName: (venue.name as string) ?? "",
        venueEstablishmentType: (venue.establishment_type as string) ?? "",
        venueLat: vLat,
        venueLng: vLng,
        firstDate,
        recurrence,
        startTime: (row.start_time as string | null) ?? null,
        nextOccurrenceLabel: buildOccurrenceLabel({
          first_date: firstDate,
          recurrence,
          start_time: (row.start_time as string | null) ?? null,
          end_time: (row.end_time as string | null) ?? null,
          event_time: (row.event_time as string | null) ?? null,
          event_frequency: (row.event_frequency as string | null) ?? null,
        }),
      };
    });
  } catch (err) {
    console.error("[getPublishedEventsByIds] Unexpected error:", err);
    return [];
  }
}
