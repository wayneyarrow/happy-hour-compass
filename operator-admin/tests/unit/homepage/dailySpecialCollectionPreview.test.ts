import { test } from "node:test";
import assert from "node:assert/strict";
import { toDailySpecialPreviewItems } from "../../../src/lib/data/collectionsPreview";
import { MANUAL_ADD_REASON } from "../../../src/lib/data/collectionsShared";
import type { CollectionDailySpecialOverride } from "../../../src/lib/data/collectionsShared";
import type { WebsiteDailySpecialListItem } from "../../../src/lib/data/dailySpecials";

/**
 * toDailySpecialPreviewItems() — the pure mapping from selectTodaysSpecials'
 * already-ranked/selected output to the generic CollectionPreviewItem shape
 * ResolvedCollectionTable.tsx renders (Source badge, Boost input). The
 * ranking/eligibility/override-safety logic itself is fully covered by
 * tests/unit/homepage/todaysSpecialsRanking.test.ts (selectTodaysSpecials is
 * reused unmodified — see resolveAlgorithmicDailySpecials's header comment
 * in collectionsPreview.ts); this only pins the display-mapping layer on
 * top of it.
 */

function buildSpecial(overrides: Partial<WebsiteDailySpecialListItem> = {}): WebsiteDailySpecialListItem {
  return {
    id: "special-1",
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
    venueLat: null,
    venueLng: null,
    venueIsVerified: false,
    marketSlug: "central-okanagan",
    citySlug: "kelowna",
    ...overrides,
  };
}

function override(overrides: Partial<CollectionDailySpecialOverride> = {}): CollectionDailySpecialOverride {
  return {
    id: "override-1",
    collectionId: "collection-1",
    dailySpecialId: "special-1",
    dailySpecialLabel: null,
    action: "include",
    boost: 0,
    sortOrder: 0,
    reasonType: null,
    note: null,
    createdAt: "",
    createdBy: null,
    updatedAt: "",
    updatedBy: null,
    ...overrides,
  };
}

test("maps title to primaryLabel and venue + offer type to secondaryLabel", () => {
  const [item] = toDailySpecialPreviewItems([buildSpecial({ offerType: "drink" })], []);
  assert.equal(item.primaryLabel, "Taco Tuesday");
  assert.equal(item.secondaryLabel, "The Placery · Drink");
});

test("an item with no matching override is origin 'algorithm' and not boosted", () => {
  const [item] = toDailySpecialPreviewItems([buildSpecial()], []);
  assert.equal(item.origin, "algorithm");
  assert.equal(item.boosted, false);
});

test("a genuine manual add (MANUAL_ADD_REASON) is origin 'manual-include'", () => {
  const overrides = [override({ dailySpecialId: "special-1", action: "include", reasonType: MANUAL_ADD_REASON })];
  const [item] = toDailySpecialPreviewItems([buildSpecial()], overrides);
  assert.equal(item.origin, "manual-include");
});

test("an include override WITHOUT MANUAL_ADD_REASON (a promotion/boost row) stays origin 'algorithm'", () => {
  const overrides = [override({ dailySpecialId: "special-1", action: "include", boost: 20, reasonType: null })];
  const [item] = toDailySpecialPreviewItems([buildSpecial()], overrides);
  assert.equal(item.origin, "algorithm");
  assert.equal(item.boosted, true);
});

test("boosted reflects boost > 0 regardless of origin", () => {
  const overrides = [override({ dailySpecialId: "special-1", boost: 0 })];
  const [item] = toDailySpecialPreviewItems([buildSpecial()], overrides);
  assert.equal(item.boosted, false);
});

test("ordering follows the input Specials array (already ranked upstream), not the overrides array", () => {
  const a = buildSpecial({ id: "a", title: "A" });
  const b = buildSpecial({ id: "b", title: "B" });
  const items = toDailySpecialPreviewItems([a, b], []);
  assert.deepEqual(items.map((i) => i.id), ["a", "b"]);
});
