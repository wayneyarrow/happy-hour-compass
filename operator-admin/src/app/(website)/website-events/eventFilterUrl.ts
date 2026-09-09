/**
 * Pure URL <-> filter-state conversion for the Events discovery page's
 * `?date=`/`?from=`/`?to=`/`?type=`/`?q=` sync (EventSearchResults.tsx).
 * Extracted so the URL contract itself — in particular the Events
 * search-field UX correction's `q` behavior (combines with `type`/`date`,
 * clearing `q` preserves the others, a direct `?q=...` URL round-trips) —
 * is directly unit-testable without a React render harness. No I/O, no
 * React — EventSearchResults.tsx owns state and still does its own
 * `type`/`date` validation against EVENT_TYPE_OPTIONS/live calendar state;
 * this module only builds/reads the query string itself.
 */

export type EventDateFilter = "today" | "tomorrow" | "weekend" | null;

export type EventFilterUrlState = {
  dateFilter: EventDateFilter;
  /** Only used when dateFilter is null — an applied calendar range, both ISO "YYYY-MM-DD" or both null. */
  rangeStart: string | null;
  rangeEnd: string | null;
  activeType: string | null;
  /** Free-text query — independent of activeType (see eventMatchesSearch()'s header comment). Untrimmed is fine; only trimmed non-empty text is written. */
  query: string;
};

/**
 * Builds the `?...` query string (no leading "?") for the given filter
 * state — date/range are mutually exclusive (a chip filter wins over an
 * applied calendar range), type and q are independent and both optional.
 * Returns "" when no filter is active (caller falls back to the bare path).
 */
export function buildEventFilterSearchParams(state: EventFilterUrlState): string {
  const parts: string[] = [];
  if (state.dateFilter) {
    parts.push(`date=${state.dateFilter}`);
  } else if (state.rangeStart && state.rangeEnd) {
    parts.push(`from=${state.rangeStart}`);
    parts.push(`to=${state.rangeEnd}`);
  }
  if (state.activeType) parts.push(`type=${encodeURIComponent(state.activeType)}`);
  if (state.query.trim()) parts.push(`q=${encodeURIComponent(state.query.trim())}`);
  return parts.join("&");
}

export type ParsedEventFilterSearchParams = {
  dateParam: EventDateFilter;
  fromParam: string | null;
  toParam: string | null;
  typeParam: string | null;
  qParam: string | null;
};

/**
 * Reads raw filter values back out of a `location.search`-shaped string
 * (leading "?" optional). `dateParam` is narrowed to the three known chip
 * values (or null) here since that's a closed set; `typeParam` is returned
 * as a raw string for the caller to validate against the live
 * EVENT_TYPE_OPTIONS list (kept in the component, not duplicated here).
 */
export function parseEventFilterSearchParams(search: string): ParsedEventFilterSearchParams {
  const params = new URLSearchParams(search);
  const dateParam = params.get("date");
  return {
    dateParam: dateParam === "today" || dateParam === "tomorrow" || dateParam === "weekend" ? dateParam : null,
    fromParam: params.get("from"),
    toParam: params.get("to"),
    typeParam: params.get("type"),
    qParam: params.get("q"),
  };
}
