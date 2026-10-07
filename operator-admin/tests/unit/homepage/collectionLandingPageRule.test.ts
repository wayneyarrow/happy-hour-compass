import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COLLECTION_TYPES,
  hasPublicCollectionLandingPage,
} from "../../../src/lib/data/collectionsShared";

/**
 * hasPublicCollectionLandingPage() — the one rule for which Collection types
 * get a public /{market}/collections/{slug} page. daily_special has none
 * (Today's Specials lives at /website-daily-specials), so the public route
 * 404s it and sitemap.ts must never list it. Both must use this same helper
 * so they can't drift apart again (the todays-specials-kelowna sitemap 404).
 */

const ROOT = join(__dirname, "../../..");
const PUBLIC_SOURCE = readFileSync(join(ROOT, "src/lib/data/collectionPublic.ts"), "utf8");
const SITEMAP_SOURCE = readFileSync(join(ROOT, "src/app/sitemap.ts"), "utf8");

test("rule: venue/event/guide have landing pages, daily_special does not", () => {
  assert.equal(hasPublicCollectionLandingPage("venue"), true);
  assert.equal(hasPublicCollectionLandingPage("event"), true);
  assert.equal(hasPublicCollectionLandingPage("guide"), true);
  assert.equal(hasPublicCollectionLandingPage("daily_special"), false);
});

test("rule: every known Collection type has an explicit answer", () => {
  assert.deepEqual([...COLLECTION_TYPES].sort(), ["daily_special", "event", "guide", "venue"]);
  for (const type of COLLECTION_TYPES) {
    assert.equal(typeof hasPublicCollectionLandingPage(type), "boolean", type);
  }
});

test("public route resolution uses the shared rule (no inline daily_special check)", () => {
  assert.match(PUBLIC_SOURCE, /if \(!hasPublicCollectionLandingPage\(collection\.collectionType\)\) return null;/);
  assert.doesNotMatch(PUBLIC_SOURCE, /collectionType === "daily_special"/);
});

test("sitemap Collection entries are filtered by the same shared rule", () => {
  assert.match(SITEMAP_SOURCE, /if \(!hasPublicCollectionLandingPage\(collection\.collectionType\)\) return \[\];/);
  assert.doesNotMatch(SITEMAP_SOURCE, /daily_special"/);
});
