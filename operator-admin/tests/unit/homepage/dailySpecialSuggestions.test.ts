import { test } from "node:test";
import assert from "node:assert/strict";
import { toDailySpecialSuggestion } from "../../../src/app/(website)/dailySpecialSuggestions";
import { dailySpecialMatchesSearch } from "../../../src/lib/dailySpecialSchedule";
import type { WebsiteDailySpecialListItem } from "../../../src/lib/data/dailySpecials";

/**
 * Homepage Daily Specials-mode autocomplete. Two things pinned here:
 *   1. toDailySpecialSuggestion() — the pure mapping from an
 *      already-fetched, already-eligible Special to the compact
 *      autocomplete shape (title/venue/context/href).
 *   2. The matching POLICY searchDailySpecialSuggestions() applies
 *      (dailySpecialMatchesSearch against title/shortSummary/description
 *      only) — this is the actual bug being fixed: a query like "wine"
 *      must match a Special whose own content mentions wine, and must
 *      NEVER match merely because it belongs to a venue named e.g.
 *      "SpearHead Winery". venueName is deliberately not one of the
 *      matched fields.
 */

function baseSpecial(overrides: Partial<WebsiteDailySpecialListItem> = {}): WebsiteDailySpecialListItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Taco Tuesday",
    offerType: "food",
    shortSummary: null,
    description: null,
    conditions: null,
    imageUrl: null,
    schedule: { scheduleType: "weekly", daysOfWeek: [3], recurrenceStartDate: null, recurrenceEndDate: null },
    time: { timeMode: "timed", startTime: "16:00", endMode: "time", endTime: "21:00" },
    venueId: "venue-1",
    venueName: "The Placery",
    venueSlug: "the-placery",
    venueEstablishmentType: "restaurant",
    venuePlaceholderImagePath: null,
    venueLat: 49.888,
    venueLng: -119.496,
    venueIsVerified: false,
    marketSlug: "central-okanagan",
    citySlug: "kelowna",
    ...overrides,
  };
}

// ── toDailySpecialSuggestion() ──────────────────────────────────────────────

test("toDailySpecialSuggestion builds the venue anchor href, title, and venue name", () => {
  const special = baseSpecial();
  const suggestion = toDailySpecialSuggestion(special);
  assert.ok(suggestion);
  assert.equal(suggestion!.id, special.id);
  assert.equal(suggestion!.title, "Taco Tuesday");
  assert.equal(suggestion!.venueName, "The Placery");
  assert.equal(suggestion!.href, `/central-okanagan/kelowna/the-placery#daily-special-${special.id}`);
});

test("toDailySpecialSuggestion prefers shortSummary as the context line when present", () => {
  const suggestion = toDailySpecialSuggestion(baseSpecial({ shortSummary: "$2 tacos, all day" }));
  assert.equal(suggestion!.contextLabel, "$2 tacos, all day");
});

test("toDailySpecialSuggestion falls back to a schedule/time line when there's no shortSummary", () => {
  const suggestion = toDailySpecialSuggestion(baseSpecial({ shortSummary: null }));
  assert.equal(suggestion!.contextLabel, "Every Wednesday · 4-9 PM");
});

test("toDailySpecialSuggestion returns null when the venue has no resolvable canonical URL", () => {
  const suggestion = toDailySpecialSuggestion(baseSpecial({ marketSlug: null }));
  assert.equal(suggestion, null);
});

// ── Matching policy: title/shortSummary/description only, never venueName ──

test("a query matching the Special's own title/summary/description is included", () => {
  const wineSpecial = baseSpecial({ title: "Wine Wednesday", shortSummary: "Half-price bottles of red and white wine" });
  const matches = dailySpecialMatchesSearch(
    { title: wineSpecial.title, shortSummary: wineSpecial.shortSummary, description: wineSpecial.description },
    "wine"
  );
  assert.equal(matches, true);
});

test("a query matching only the venue's name does NOT match the Special (the bug being fixed)", () => {
  // SpearHead Winery — venue name contains "wine", but this Special's own
  // title/summary/description do not. It must not surface for "wine".
  const unrelatedSpecial = baseSpecial({
    title: "Taco Tuesday",
    shortSummary: "$2 tacos, all day",
    description: null,
    venueName: "SpearHead Winery",
  });
  const matches = dailySpecialMatchesSearch(
    { title: unrelatedSpecial.title, shortSummary: unrelatedSpecial.shortSummary, description: unrelatedSpecial.description },
    "wine"
  );
  assert.equal(matches, false);
});
