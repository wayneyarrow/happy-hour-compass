// ─── Price Formatter ──────────────────────────────────────────────────────────

/**
 * Normalises a user-entered price string for consistent display.
 *
 * Rules:
 *   "free" (any case) → "Free"
 *   "$20"             → "$20"   (already has symbol — pass through)
 *   "20"              → "$20"
 *   "20.00"           → "$20.00"
 *   "20–35"           → "$20–35"
 */
export function formatPrice(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const v = raw.trim();
  if (v.toLowerCase() === "free") return "Free";
  if (v.startsWith("$")) return v;
  return `$${v}`;
}

// ─── Detail Date Label ────────────────────────────────────────────────────────

const DAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
] as const;

const DAY_NAMES_PLURAL = [
  "Sundays", "Mondays", "Tuesdays", "Wednesdays",
  "Thursdays", "Fridays", "Saturdays",
] as const;

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

// start_time / end_time are stored already formatted (e.g. "8:00 PM") — pass
// through verbatim so the displayed time always matches what the operator entered.
function fmtTimeRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = start.trim();
  if (!end) return s;
  return `${s}–${end.trim()}`;
}

function parseDow(firstDate: string | null): number | null {
  if (!firstDate) return null;
  const m = firstDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
}

/**
 * Builds a human-readable date/time label for the event detail page.
 *
 * One-off:   "Tuesday, Jun 30 • 8:00 PM–10:00 PM"
 * Weekly:    "Tuesdays • 8:00 PM–10:00 PM"
 * Biweekly:  "Every other Tuesday • 8:00 PM"
 * Daily:     "Daily • 8:00 PM"
 * Monthly:   "Monthly • 8:00 PM"
 */
export function buildDetailDateLabel(
  firstDate: string | null,
  recurrence: string | null,
  startTime: string | null,
  endTime: string | null
): string {
  const timeStr = fmtTimeRange(startTime, endTime);
  const rec = recurrence ?? "none";

  if (rec === "daily") {
    return timeStr ? `Daily • ${timeStr}` : "Daily";
  }

  if (rec === "weekly") {
    const dow = parseDow(firstDate);
    const label = dow !== null ? DAY_NAMES_PLURAL[dow] : "Weekly";
    return timeStr ? `${label} • ${timeStr}` : label;
  }

  if (rec === "biweekly") {
    const dow = parseDow(firstDate);
    const label = dow !== null ? `Every other ${DAY_NAMES[dow]}` : "Every other week";
    return timeStr ? `${label} • ${timeStr}` : label;
  }

  if (rec === "monthly") {
    return timeStr ? `Monthly • ${timeStr}` : "Monthly";
  }

  // One-off (recurrence === "none" or unrecognized)
  if (firstDate) {
    const m = firstDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
      const datePart = `${DAY_NAMES[dow]}, ${MONTHS_SHORT[+m[2] - 1]} ${+m[3]}`;
      return timeStr ? `${datePart} • ${timeStr}` : datePart;
    }
  }

  return timeStr ?? "";
}
