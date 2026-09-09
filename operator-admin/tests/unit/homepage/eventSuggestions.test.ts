import { test } from "node:test";
import assert from "node:assert/strict";
import { toEventSuggestion } from "../../../src/app/(website)/eventSuggestions";
import { eventMatchesSearch } from "../../../src/lib/eventSearch";
import { getEventTypeLabel } from "../../../src/lib/eventTypes";
import type { WebsiteEventListItem } from "../../../src/lib/data/events";

/**
 * Homepage Events-mode autocomplete. Pins:
 *   1. toEventSuggestion() — the pure mapping from an already-fetched,
 *      already-eligible Event to the compact autocomplete shape, including
 *      its href fallback (canonical path, else the UUID-compatibility
 *      route — the exact same fallback EventSearchCard.tsx uses, not a
 *      new destination invented for this task).
 *   2. The matching POLICY searchEventSuggestions() applies
 *      (eventMatchesSearch against title/description/event-type-label) —
 *      the actual bug being fixed: a query like "trivia" must match real
 *      Event content, not venue suggestions.
 */

function baseEvent(overrides: Partial<WebsiteEventListItem> = {}): WebsiteEventListItem {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    slug: "tuesday-trivia-night",
    title: "Tuesday Trivia Night",
    description: "Weekly trivia hosted by our bar staff.",
    imageUrl: null,
    eventType: "trivia",
    venueName: "The Placery",
    venueEstablishmentType: "restaurant",
    venueLat: 49.888,
    venueLng: -119.496,
    marketSlug: "central-okanagan",
    citySlug: "kelowna",
    firstDate: "2026-09-15",
    recurrence: "weekly",
    startTime: "19:00",
    nextOccurrenceLabel: "Tuesdays 7:00 PM",
    teaser: null,
    ...overrides,
  };
}

// ── toEventSuggestion() ──────────────────────────────────────────────────────

test("toEventSuggestion builds the canonical path, title, venue name, and occurrence label", () => {
  const suggestion = toEventSuggestion(baseEvent());
  assert.equal(suggestion.id, "22222222-2222-2222-2222-222222222222");
  assert.equal(suggestion.title, "Tuesday Trivia Night");
  assert.equal(suggestion.venueName, "The Placery");
  assert.equal(suggestion.occurrenceLabel, "Tuesdays 7:00 PM");
  assert.equal(suggestion.href, "/central-okanagan/kelowna/events/tuesday-trivia-night");
});

test("toEventSuggestion falls back to the UUID-compatibility route when the canonical path can't be built", () => {
  const suggestion = toEventSuggestion(baseEvent({ marketSlug: null }));
  assert.equal(suggestion.href, "/website-events/22222222-2222-2222-2222-222222222222");
});

test("toEventSuggestion carries a type emoji for a known event type and an empty string for none", () => {
  assert.equal(toEventSuggestion(baseEvent({ eventType: "trivia" })).typeEmoji, "🧠");
  assert.equal(toEventSuggestion(baseEvent({ eventType: null })).typeEmoji, "");
});

// ── Matching policy: real Event content, never a venue stand-in ────────────

test("a query matching the Event's title is included", () => {
  const event = baseEvent();
  const matches = eventMatchesSearch(
    { title: event.title, description: event.description, eventTypeLabel: getEventTypeLabel(event.eventType) },
    "trivia"
  );
  assert.equal(matches, true);
});

test("a query matching only the event type (not the title/description text) is still included", () => {
  const event = baseEvent({ title: "Thursday Night Showdown", description: "Prizes for the winning team." });
  const matches = eventMatchesSearch(
    { title: event.title, description: event.description, eventTypeLabel: getEventTypeLabel(event.eventType) },
    "trivia"
  );
  assert.equal(matches, true);
});

test("an unrelated Event (wrong type, no matching text) does not match", () => {
  const jazzNight = baseEvent({
    title: "Live Jazz Evening",
    description: "Smooth jazz and cocktails.",
    eventType: "live_music",
  });
  const matches = eventMatchesSearch(
    { title: jazzNight.title, description: jazzNight.description, eventTypeLabel: getEventTypeLabel(jazzNight.eventType) },
    "trivia"
  );
  assert.equal(matches, false);
});
