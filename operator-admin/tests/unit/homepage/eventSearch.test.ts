import { test } from "node:test";
import assert from "node:assert/strict";
import { eventMatchesSearch } from "../../../src/lib/eventSearch";

/**
 * Pure Event free-text matcher — the single source of truth used by both
 * the homepage Hero's Events-mode autocomplete (eventSuggestions.ts) and
 * the /website-events `?q=` results filter (EventSearchResults.tsx).
 */

test("empty query matches everything", () => {
  assert.equal(
    eventMatchesSearch({ title: "Anything", description: null, eventTypeLabel: null }, ""),
    true
  );
  assert.equal(
    eventMatchesSearch({ title: "Anything", description: null, eventTypeLabel: null }, "   "),
    true
  );
});

test("matches on title, case-insensitively", () => {
  assert.equal(
    eventMatchesSearch({ title: "Tuesday Trivia Night", description: null, eventTypeLabel: "Trivia" }, "TRIVIA"),
    true
  );
});

test("matches on description when title doesn't contain the query", () => {
  assert.equal(
    eventMatchesSearch(
      { title: "Game Night", description: "Weekly trivia hosted by our bar staff.", eventTypeLabel: "Trivia" },
      "trivia"
    ),
    true
  );
});

test("matches on event type label even when the word appears in neither title nor description", () => {
  // e.g. an event titled "Thursday Night Showdown" with no "trivia" text
  // anywhere, but categorized as a Trivia event — the query should still
  // surface it, since eventTypeLabel is one of the matched fields.
  assert.equal(
    eventMatchesSearch({ title: "Thursday Night Showdown", description: null, eventTypeLabel: "Trivia" }, "trivia"),
    true
  );
});

test("does not match unrelated content", () => {
  assert.equal(
    eventMatchesSearch(
      { title: "Live Jazz Evening", description: "Smooth jazz and cocktails.", eventTypeLabel: "Live Music" },
      "trivia"
    ),
    false
  );
});

test("null description and null eventTypeLabel are handled safely", () => {
  assert.equal(
    eventMatchesSearch({ title: "Karaoke Night", description: null, eventTypeLabel: null }, "trivia"),
    false
  );
});

// ── Combined with an independent Event Type filter ──────────────────────────
// EventSearchResults.tsx's `filtered` pipeline applies an `activeType`
// equality filter and this matcher as two separate, chained .filter()
// calls (AND semantics) — replicated here directly to pin that a text
// query never implies/selects a type, and a type filter never implies/
// selects query text; only the intersection of both survives.

type FixtureEvent = { title: string; description: string | null; eventType: string; eventTypeLabel: string };

const trueTriviaNight: FixtureEvent = {
  title: "Tuesday Trivia Night",
  description: null,
  eventType: "trivia",
  eventTypeLabel: "Trivia",
};
const communityTriviaFundraiser: FixtureEvent = {
  title: "Trivia Fundraiser",
  description: null,
  eventType: "community",
  eventTypeLabel: "Community",
};
const unrelatedCommunityEvent: FixtureEvent = {
  title: "Neighbourhood Cleanup",
  description: null,
  eventType: "community",
  eventTypeLabel: "Community",
};

function applyQueryAndType(events: FixtureEvent[], query: string, activeType: string | null): FixtureEvent[] {
  return events
    .filter((e) => (activeType ? e.eventType === activeType : true))
    .filter((e) => eventMatchesSearch({ title: e.title, description: e.description, eventTypeLabel: e.eventTypeLabel }, query));
}

test("q + Event Type combine as an intersection (AND), not either alone", () => {
  const events = [trueTriviaNight, communityTriviaFundraiser, unrelatedCommunityEvent];

  // "trivia" alone matches both Trivia-titled events, regardless of type.
  assert.deepEqual(
    applyQueryAndType(events, "trivia", null).map((e) => e.title),
    ["Tuesday Trivia Night", "Trivia Fundraiser"]
  );

  // type=community alone matches both Community-type events, regardless of title.
  assert.deepEqual(
    applyQueryAndType(events, "", "community").map((e) => e.title),
    ["Trivia Fundraiser", "Neighbourhood Cleanup"]
  );

  // Both together: only the event satisfying BOTH survives.
  assert.deepEqual(
    applyQueryAndType(events, "trivia", "community").map((e) => e.title),
    ["Trivia Fundraiser"]
  );
});

test("a text query never implies/selects an Event Type on its own", () => {
  // Searching "trivia" with no explicit type filter must still return the
  // trivia-typed AND the community-typed trivia-titled event — proving the
  // query text was never silently translated into `activeType: "trivia"`.
  const events = [trueTriviaNight, communityTriviaFundraiser, unrelatedCommunityEvent];
  const results = applyQueryAndType(events, "trivia", null);
  assert.equal(results.length, 2);
  assert.ok(results.some((e) => e.eventType === "trivia"));
  assert.ok(results.some((e) => e.eventType === "community"));
});
