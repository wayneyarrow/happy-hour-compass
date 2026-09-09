import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEventFilterSearchParams,
  parseEventFilterSearchParams,
  type EventFilterUrlState,
} from "../../../src/app/(website)/website-events/eventFilterUrl";

/**
 * Events discovery page's `?date=`/`?from=`/`?to=`/`?type=`/`?q=` URL
 * contract — pins the Events search-field UX correction's URL-behavior
 * requirements: q combines with the other filters, clearing q preserves
 * them, and a direct `?q=...` URL round-trips through build+parse.
 */

function state(overrides: Partial<EventFilterUrlState> = {}): EventFilterUrlState {
  return { dateFilter: null, rangeStart: null, rangeEnd: null, activeType: null, query: "", ...overrides };
}

// ── buildEventFilterSearchParams ────────────────────────────────────────────

test("no active filters builds an empty string", () => {
  assert.equal(buildEventFilterSearchParams(state()), "");
});

test("q alone builds q=<query>", () => {
  assert.equal(buildEventFilterSearchParams(state({ query: "trivia" })), "q=trivia");
});

test("q + type combine in the URL", () => {
  assert.equal(
    buildEventFilterSearchParams(state({ query: "trivia", activeType: "community" })),
    "type=community&q=trivia"
  );
});

test("q + a date chip combine in the URL", () => {
  assert.equal(buildEventFilterSearchParams(state({ query: "trivia", dateFilter: "today" })), "date=today&q=trivia");
});

test("q + an applied calendar range combine in the URL", () => {
  assert.equal(
    buildEventFilterSearchParams(state({ query: "trivia", rangeStart: "2026-09-20", rangeEnd: "2026-09-22" })),
    "from=2026-09-20&to=2026-09-22&q=trivia"
  );
});

test("a date chip wins over an applied range when both happen to be set", () => {
  assert.equal(
    buildEventFilterSearchParams(state({ dateFilter: "weekend", rangeStart: "2026-09-20", rangeEnd: "2026-09-22" })),
    "date=weekend"
  );
});

test("clearing the query (empty string) drops q but preserves type/date", () => {
  assert.equal(
    buildEventFilterSearchParams(state({ query: "", activeType: "community", dateFilter: "today" })),
    "date=today&type=community"
  );
});

test("a whitespace-only query is treated as empty (no q written)", () => {
  assert.equal(buildEventFilterSearchParams(state({ query: "   " })), "");
});

test("query is URL-encoded", () => {
  assert.equal(buildEventFilterSearchParams(state({ query: "wine & cheese" })), "q=wine%20%26%20cheese");
});

// ── parseEventFilterSearchParams ────────────────────────────────────────────

test("parses q back out of a search string", () => {
  const parsed = parseEventFilterSearchParams("?q=trivia");
  assert.equal(parsed.qParam, "trivia");
});

test("parses q alongside type/date", () => {
  const parsed = parseEventFilterSearchParams("?q=trivia&type=community&date=today");
  assert.equal(parsed.qParam, "trivia");
  assert.equal(parsed.typeParam, "community");
  assert.equal(parsed.dateParam, "today");
});

test("an unknown date value parses to null rather than being trusted verbatim", () => {
  const parsed = parseEventFilterSearchParams("?date=someday");
  assert.equal(parsed.dateParam, null);
});

test("absent q parses to null (not an empty string)", () => {
  const parsed = parseEventFilterSearchParams("?type=community");
  assert.equal(parsed.qParam, null);
});

// ── Round-trip: build then parse recovers the same q/type/date ─────────────

test("round-trips q + type + date through build -> parse", () => {
  const built = buildEventFilterSearchParams(state({ query: "trivia", activeType: "community", dateFilter: "weekend" }));
  const parsed = parseEventFilterSearchParams(`?${built}`);
  assert.equal(parsed.qParam, "trivia");
  assert.equal(parsed.typeParam, "community");
  assert.equal(parsed.dateParam, "weekend");
});

test("a direct /website-events?q=trivia URL parses to just qParam, nothing else set", () => {
  const parsed = parseEventFilterSearchParams("?q=trivia");
  assert.equal(parsed.qParam, "trivia");
  assert.equal(parsed.typeParam, null);
  assert.equal(parsed.dateParam, null);
  assert.equal(parsed.fromParam, null);
  assert.equal(parsed.toParam, null);
});

// ── Independence: q never implies a type, and vice versa ───────────────────

test("q is never inferred as a typeParam, even when the query text matches a real event type value", () => {
  // "community" is a real EVENT_TYPE_DEFS key — a query of that exact text
  // must still land only in qParam, never typeParam, proving text search
  // and Event Type stay fully independent filters.
  const parsed = parseEventFilterSearchParams("?q=community");
  assert.equal(parsed.qParam, "community");
  assert.equal(parsed.typeParam, null);
});
