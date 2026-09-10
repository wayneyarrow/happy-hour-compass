import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLLECTION_TYPES,
  isCollectionType,
  ALGORITHM_KEYS,
  ALGORITHM_COLLECTION_TYPE,
  isAlgorithmKey,
  validateAlgorithmKey,
} from "../../../src/lib/data/collectionsShared";
import {
  HOMEPAGE_SECTION_TYPES,
  HOMEPAGE_SECTION_KINDS,
  SECTION_KIND_LABELS,
  isHomepageSectionType,
  isHomepageSectionKind,
  toSectionKind,
  fromSectionKind,
} from "../../../src/lib/data/homepagesShared";

/**
 * Today's Specials CMS/CPanel integration — migration
 * 092_daily_special_collections.sql widened collections.collection_type
 * and homepage_sections.section_type to a 4th value, "daily_special". This
 * pins the TypeScript-side widening: existing venue/event/guide values
 * remain valid, the new value is accepted, and (critically) the
 * fromSectionKind() parsing bug this widening exposed — a naive
 * `"_"`.split(1) breaks on a sectionType that itself contains an
 * underscore — is fixed and stays fixed.
 */

// ── Collection type ─────────────────────────────────────────────────────────

test("existing collection types remain valid", () => {
  assert.equal(isCollectionType("venue"), true);
  assert.equal(isCollectionType("event"), true);
  assert.equal(isCollectionType("guide"), true);
});

test("daily_special is now a valid collection type", () => {
  assert.equal(isCollectionType("daily_special"), true);
  assert.ok(COLLECTION_TYPES.includes("daily_special"));
});

test("an unrelated string is still rejected", () => {
  assert.equal(isCollectionType("not-a-real-type"), false);
});

// ── Algorithm key registry ───────────────────────────────────────────────────

test("existing algorithm keys remain mapped to their original collection type", () => {
  assert.equal(ALGORITHM_COLLECTION_TYPE["patio-picks"], "venue");
  assert.equal(ALGORITHM_COLLECTION_TYPE["featured-events"], "event");
});

test("todays-specials is a valid algorithm key mapped to daily_special", () => {
  assert.equal(isAlgorithmKey("todays-specials"), true);
  assert.ok(ALGORITHM_KEYS.includes("todays-specials"));
  assert.equal(ALGORITHM_COLLECTION_TYPE["todays-specials"], "daily_special");
});

test("todays-specials is only valid for a daily_special Collection, not venue/event", () => {
  assert.equal(validateAlgorithmKey("todays-specials", "daily_special"), null);
  assert.notEqual(validateAlgorithmKey("todays-specials", "venue"), null);
  assert.notEqual(validateAlgorithmKey("todays-specials", "event"), null);
});

// ── Homepage Section type/kind ───────────────────────────────────────────────

test("existing homepage section types remain valid", () => {
  assert.equal(isHomepageSectionType("venue"), true);
  assert.equal(isHomepageSectionType("event"), true);
  assert.equal(isHomepageSectionType("guide"), true);
});

test("daily_special is now a valid homepage section type", () => {
  assert.equal(isHomepageSectionType("daily_special"), true);
  assert.ok(HOMEPAGE_SECTION_TYPES.includes("daily_special"));
});

test("daily_special_collection is a recognized section kind with a label, and there is no daily_special_feature variant", () => {
  assert.equal(isHomepageSectionKind("daily_special_collection"), true);
  assert.equal(SECTION_KIND_LABELS.daily_special_collection, "Daily Special Collection");
  assert.equal(isHomepageSectionKind("daily_special_feature"), false);
  assert.ok(HOMEPAGE_SECTION_KINDS.includes("guide_feature")); // sanity: existing kinds still present
});

test("toSectionKind builds the compound daily_special_collection kind", () => {
  assert.equal(toSectionKind("daily_special", "collection"), "daily_special_collection");
});

// This is the bug fromSectionKind's naive split("_") had: "daily_special"
// itself contains an underscore, so `kind.split("_")` on
// "daily_special_collection" produces THREE parts ("daily", "special",
// "collection") instead of the intended two. fromSectionKind must split on
// the LAST underscore only.
test("fromSectionKind correctly parses a sectionType that itself contains an underscore", () => {
  const { sectionType, contentMode } = fromSectionKind("daily_special_collection");
  assert.equal(sectionType, "daily_special");
  assert.equal(contentMode, "collection");
});

test("fromSectionKind still correctly parses existing single-word sectionTypes", () => {
  assert.deepEqual(fromSectionKind("venue_collection"), { sectionType: "venue", contentMode: "collection" });
  assert.deepEqual(fromSectionKind("event_feature"), { sectionType: "event", contentMode: "feature" });
  assert.deepEqual(fromSectionKind("guide_collection"), { sectionType: "guide", contentMode: "collection" });
});

test("toSectionKind and fromSectionKind round-trip for every existing and new kind", () => {
  for (const kind of HOMEPAGE_SECTION_KINDS) {
    const { sectionType, contentMode } = fromSectionKind(kind);
    assert.equal(toSectionKind(sectionType, contentMode), kind);
  }
});
