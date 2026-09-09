/**
 * Central types/constants for Daily Specials — Phase 1 data foundation.
 *
 * Daily Specials are a separate, first-class content type from Events
 * (public.events) and Happy Hours (columns on venues) — see
 * supabase/migrations/091_daily_specials_foundation.sql for the full
 * schema/architecture rationale. This file is the single source of truth
 * for the closed value sets (offer_type, schedule_type, time_mode,
 * end_mode) and the persisted-row shape, so no magic strings are
 * duplicated across Operator Admin, consumer, and Control Panel code as
 * those surfaces are built in later phases.
 *
 * Mirrors the split already used for Events: src/lib/eventTypes.ts (types/
 * constants) is separate from src/app/admin/events/recurrenceUtils.ts
 * (pure schedule logic) and src/lib/data/events.ts (server data access).
 * The Daily Specials equivalents are src/lib/dailySpecialTypes.ts (this
 * file), src/lib/dailySpecialSchedule.ts (pure schedule/occurrence logic),
 * and src/lib/data/dailySpecials.ts (server data access) — promoted to
 * top-level src/lib/ rather than admin/events-style route-scoped, because
 * unlike recurrenceUtils.ts, this logic is expected to be reused by both
 * Operator Admin AND consumer/website code in later phases.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Content length limits
//
// Application-layer only — no database CHECK constraint backs these
// (Phase 2 correction task explicitly deferred any schema change; a hard
// DB-level limit can be added later if it ever proves necessary). Shared
// here so the Operator Admin form (client-side maxLength + live counter)
// and saveDailySpecialAction (authoritative server validation via
// validateDailySpecialContent() in dailySpecialSchedule.ts) can never
// drift out of sync with two independently-maintained numbers.
//
// Conditions / additional details has no limit — not requested, existing
// behavior preserved.
// ─────────────────────────────────────────────────────────────────────────────

export const SHORT_SUMMARY_MAX_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Offer type
// ─────────────────────────────────────────────────────────────────────────────

export const OFFER_TYPES = ["food", "drink", "food_drink"] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  food:       "Food",
  drink:      "Drink",
  food_drink: "Food & Drink",
};

export function isOfferType(value: unknown): value is OfferType {
  return typeof value === "string" && (OFFER_TYPES as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule type
//
// Deliberately NOT just an is_recurring boolean (matches
// daily_specials_schedule_type_check) — a closed, extensible set so a
// future 'monthly' or 'custom' value can be added later without a breaking
// rename. v1 supports exactly 'one_time' and 'weekly' — see the Phase 1
// task brief; do not add further values without a corresponding migration.
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEDULE_TYPES = ["one_time", "weekly"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export function isScheduleType(value: unknown): value is ScheduleType {
  return typeof value === "string" && (SCHEDULE_TYPES as readonly string[]).includes(value);
}

/**
 * Weekday numbering — 0=Sunday .. 6=Saturday. Matches JavaScript's
 * `Date.prototype.getDay()`, and the same convention already used
 * elsewhere in this codebase for day-of-week logic (e.g. `dowFromIso()` in
 * src/app/(website)/website-events/EventSearchResults.tsx). Chosen
 * specifically so a future Daily Specials WHEN filter can reuse
 * `new Date().getDay()` directly with no remapping.
 */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function isWeekday(value: unknown): value is Weekday {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6;
}

export const WEEKDAY_LABELS_LONG: Record<Weekday, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

export const WEEKDAY_LABELS_SHORT: Record<Weekday, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

// ─────────────────────────────────────────────────────────────────────────────
// Time model
//
// Mirrors daily_specials_time_mode_check / daily_specials_end_mode_domain_check
// exactly. See the migration header for the full worked-examples table
// ("4 PM-Close", "Until 1 PM", etc.) and src/lib/dailySpecialSchedule.ts for
// the validation logic that enforces the same rules in application code.
// ─────────────────────────────────────────────────────────────────────────────

export const TIME_MODES = ["unspecified", "all_day", "timed"] as const;
export type TimeMode = (typeof TIME_MODES)[number];

export function isTimeMode(value: unknown): value is TimeMode {
  return typeof value === "string" && (TIME_MODES as readonly string[]).includes(value);
}

export const END_MODES = ["unspecified", "time", "close"] as const;
export type EndMode = (typeof END_MODES)[number];

export function isEndMode(value: unknown): value is EndMode {
  return typeof value === "string" && (END_MODES as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule — discriminated union
//
// Encodes daily_specials_schedule_fields_check at the type level: a
// one-time schedule always carries oneTimeDate and never a weekday set; a
// weekly schedule always carries a non-empty weekday set and never a
// one-time date. recurrenceStartDate/recurrenceEndDate are optional even
// for 'weekly' — NULL start = already active/no boundary, NULL end =
// continues indefinitely (see the migration header).
// ─────────────────────────────────────────────────────────────────────────────

export type DailySpecialOneTimeSchedule = {
  scheduleType: "one_time";
  /** ISO "YYYY-MM-DD". */
  oneTimeDate: string;
};

export type DailySpecialWeeklySchedule = {
  scheduleType: "weekly";
  /** Non-empty, no duplicates, each 0-6 — enforced by the DB CHECK constraints. */
  daysOfWeek: Weekday[];
  /** ISO "YYYY-MM-DD" or null (no explicit start boundary — already active). */
  recurrenceStartDate: string | null;
  /** ISO "YYYY-MM-DD" or null (continues indefinitely). */
  recurrenceEndDate: string | null;
};

export type DailySpecialSchedule = DailySpecialOneTimeSchedule | DailySpecialWeeklySchedule;

// ─────────────────────────────────────────────────────────────────────────────
// Time — discriminated union
//
// Encodes daily_specials_end_mode_check / daily_specials_time_mode_check_no_time_check
// / daily_specials_timed_boundary_check at the type level. 'close' never
// carries a clock time (endTime is always null for it) — resolving it
// against the venue's actual business hours is explicitly future work (not
// this phase — see the migration header's "CLOSE" note).
// ─────────────────────────────────────────────────────────────────────────────

export type DailySpecialUnspecifiedTime = { timeMode: "unspecified" };
export type DailySpecialAllDayTime = { timeMode: "all_day" };

export type DailySpecialTimedTime = {
  timeMode: "timed";
  /** "HH:MM" or "HH:MM:SS", venue-local wall clock. Null = no start specified. */
  startTime: string | null;
  endMode: EndMode;
  /** Non-null only when endMode === 'time'. Always null for 'close'/'unspecified'. */
  endTime: string | null;
};

export type DailySpecialTime =
  | DailySpecialUnspecifiedTime
  | DailySpecialAllDayTime
  | DailySpecialTimedTime;

// ─────────────────────────────────────────────────────────────────────────────
// Persisted row — raw (Supabase) and coerced (application) shapes
//
// No generated Supabase types in this project (same situation
// src/lib/venueSubscriptions.ts's header note describes) — DailySpecialDbRow
// is the raw snake_case shape read directly off the client; DailySpecial is
// the coerced, closed-union application shape used everywhere else.
// ─────────────────────────────────────────────────────────────────────────────

export type DailySpecialDbRow = {
  id: string;
  venue_id: string;
  created_by_operator_id: string | null;
  updated_by_operator_id: string | null;
  created_at: string;
  updated_at: string;
  title: string;
  offer_type: string;
  short_summary: string | null;
  description: string | null;
  conditions: string | null;
  image_url: string | null;
  schedule_type: string;
  one_time_date: string | null;
  days_of_week: number[] | null;
  recurrence_start_date: string | null;
  recurrence_end_date: string | null;
  time_mode: string;
  start_time: string | null;
  end_mode: string;
  end_time: string | null;
  is_published: boolean;
  is_seeded_special: boolean;
  source_url: string | null;
  last_verified_at: string | null;
};

export type DailySpecial = {
  id: string;
  venueId: string;
  createdByOperatorId: string | null;
  updatedByOperatorId: string | null;
  createdAt: string;
  updatedAt: string;
  title: string;
  offerType: OfferType;
  shortSummary: string | null;
  description: string | null;
  conditions: string | null;
  imageUrl: string | null;
  schedule: DailySpecialSchedule;
  time: DailySpecialTime;
  isPublished: boolean;
  isSeededSpecial: boolean;
  sourceUrl: string | null;
  lastVerifiedAt: string | null;
};

/**
 * Coerces a raw Supabase row into the typed, discriminated-union
 * application shape. Returns null (and logs) for a row whose stored
 * combination doesn't satisfy the DB CHECK constraints — should never
 * happen given those constraints, but read paths in this codebase
 * consistently degrade gracefully rather than throw (see events.ts /
 * venues.ts), so a future data-access helper can skip an unreadable row
 * instead of crashing an entire listing.
 */
export function coerceDailySpecialRow(row: DailySpecialDbRow): DailySpecial | null {
  if (!isOfferType(row.offer_type)) {
    console.error("[coerceDailySpecialRow] Unknown offer_type:", row.id, row.offer_type);
    return null;
  }

  const schedule = coerceDailySpecialSchedule(row);
  if (!schedule) {
    console.error("[coerceDailySpecialRow] Invalid schedule fields:", row.id);
    return null;
  }

  const time = coerceDailySpecialTime(row);
  if (!time) {
    console.error("[coerceDailySpecialRow] Invalid time fields:", row.id);
    return null;
  }

  return {
    id: row.id,
    venueId: row.venue_id,
    createdByOperatorId: row.created_by_operator_id,
    updatedByOperatorId: row.updated_by_operator_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title,
    offerType: row.offer_type,
    shortSummary: row.short_summary,
    description: row.description,
    conditions: row.conditions,
    imageUrl: row.image_url,
    schedule,
    time,
    isPublished: row.is_published,
    isSeededSpecial: row.is_seeded_special,
    sourceUrl: row.source_url,
    lastVerifiedAt: row.last_verified_at,
  };
}

/**
 * Exported (unlike coerceDailySpecialTime below, for the identical reason)
 * so a caller with only a partial row shape — e.g. a joined website search
 * query that never selects id/venue_id/timestamps — can still reuse this
 * exact coercion logic instead of duplicating it or constructing a fake
 * full DailySpecialDbRow just to call coerceDailySpecialRow(). Takes only
 * the columns it actually reads.
 */
export function coerceDailySpecialSchedule(
  row: Pick<DailySpecialDbRow, "schedule_type" | "one_time_date" | "days_of_week" | "recurrence_start_date" | "recurrence_end_date">
): DailySpecialSchedule | null {
  if (row.schedule_type === "one_time") {
    if (!row.one_time_date) return null;
    return { scheduleType: "one_time", oneTimeDate: row.one_time_date };
  }
  if (row.schedule_type === "weekly") {
    if (!row.days_of_week || row.days_of_week.length === 0) return null;
    if (!row.days_of_week.every(isWeekday)) return null;
    return {
      scheduleType: "weekly",
      daysOfWeek: [...row.days_of_week].sort((a, b) => a - b) as Weekday[],
      recurrenceStartDate: row.recurrence_start_date,
      recurrenceEndDate: row.recurrence_end_date,
    };
  }
  return null;
}

/** Exported for the same reason as coerceDailySpecialSchedule() above — see its own comment. */
export function coerceDailySpecialTime(
  row: Pick<DailySpecialDbRow, "time_mode" | "start_time" | "end_mode" | "end_time">
): DailySpecialTime | null {
  if (row.time_mode === "unspecified") return { timeMode: "unspecified" };
  if (row.time_mode === "all_day") return { timeMode: "all_day" };
  if (row.time_mode === "timed") {
    if (!isEndMode(row.end_mode)) return null;
    return {
      timeMode: "timed",
      startTime: row.start_time,
      endMode: row.end_mode,
      endTime: row.end_time,
    };
  }
  return null;
}
