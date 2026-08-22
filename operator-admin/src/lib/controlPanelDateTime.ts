// ─────────────────────────────────────────────────────────────────────────────
// Founder Control Panel — shared date/time display formatting
//
// PROBLEM:
//   Every timestamp column in the schema (submitted_at, updated_at, created_at,
//   claimed_at, last_seen_at, etc.) is correctly stored as PostgreSQL
//   TIMESTAMPTZ / UTC — that storage is correct and must not change.
//
//   Control Panel pages historically formatted those UTC instants with
//   `new Date(iso).toLocaleString(...)` / `toLocaleDateString(...)` and no
//   explicit `timeZone`. Formatters with no `timeZone` fall back to the
//   runtime's local timezone — on the server (Vercel) that's UTC, so the raw
//   UTC clock value gets displayed as if it were already local time. A
//   submission made at 7:54 PM Pacific (2:54 AM UTC the next calendar day)
//   was shown in the Control Panel as "2:54 AM" with no conversion at all.
//
// FIX:
//   Always pass an explicit `timeZone` to Intl/`toLocale*` so the displayed
//   value is deterministic regardless of what timezone the process happens to
//   be running in — server or client. Happy Hour Compass operates in a single
//   market timezone for founder-facing purposes, so that zone is Pacific.
//   IANA "America/Vancouver" handles PST/PDT DST transitions automatically —
//   no manual UTC offset math is ever needed.
//
// SCOPE:
//   Use these helpers for real moments in time — any TIMESTAMPTZ column
//   (`*_at` timestamps: submitted_at, updated_at, created_at, claimed_at,
//   accepted_at, cancelled_at, last_seen_at, etc.).
//
//   Do NOT use these for a plain calendar-date column that has no
//   time-of-day/instant meaning (e.g. `events.first_date`, a Postgres DATE).
//   Running a bare calendar date through a timezone conversion can shift it
//   to the wrong day (midnight UTC minus 7/8 hours lands on the previous
//   Pacific day) even though there was never a "moment in time" to convert.
//   Format those directly instead, with no `timeZone` conversion applied.
// ─────────────────────────────────────────────────────────────────────────────

export const CONTROL_PANEL_TIME_ZONE = "America/Vancouver";

function toValidDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "Aug 21, 2026, 7:54 PM" — date + time, Pacific local time.
 * Returns "—" for null/undefined/unparseable input.
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toValidDate(value);
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    timeZone: CONTROL_PANEL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "Aug 21, 2026" — date only, Pacific local time.
 * Still computed from a real UTC instant, so a timestamp near UTC midnight
 * correctly lands on the Pacific calendar day, not the UTC one.
 * Returns "—" for null/undefined/unparseable input.
 */
export function formatDate(value: string | Date | null | undefined): string {
  const d = toValidDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    timeZone: CONTROL_PANEL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * "2026-08-21" — plain ISO-style date, Pacific local time.
 * Matches the existing `toLocaleDateString("en-CA")` short-date presentation
 * used for the platform admins accepted-at column.
 * Returns "—" for null/undefined/unparseable input.
 */
export function formatDateISO(value: string | Date | null | undefined): string {
  const d = toValidDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-CA", { timeZone: CONTROL_PANEL_TIME_ZONE });
}
