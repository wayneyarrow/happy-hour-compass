import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOwnedStoragePath } from "../../../src/app/admin/daily-specials/storagePath";

/**
 * parseOwnedStoragePath() is the safety gate for image-replacement/removal
 * cleanup in src/app/admin/daily-specials/imageActions.ts — it decides
 * whether a stored image_url is something we're allowed to delete from
 * Storage. Pure, no I/O — direct unit tests.
 */

const BUCKET = "venue-images";

test("parses a real venue-images public URL into its object path", () => {
  const url = "https://xyzcompany.supabase.co/storage/v1/object/public/venue-images/daily-specials/special-1/abc-123.jpg";
  assert.equal(parseOwnedStoragePath(url, BUCKET), "daily-specials/special-1/abc-123.jpg");
});

test("returns null for a URL pointing at a different bucket", () => {
  const url = "https://xyzcompany.supabase.co/storage/v1/object/public/some-other-bucket/daily-specials/special-1/abc-123.jpg";
  assert.equal(parseOwnedStoragePath(url, BUCKET), null);
});

test("returns null for an arbitrary external URL (not blindly deleted)", () => {
  assert.equal(parseOwnedStoragePath("https://example.com/random-image.jpg", BUCKET), null);
  assert.equal(parseOwnedStoragePath("https://cdn.some-other-service.com/photo.png", BUCKET), null);
});

test("returns null for an unparseable/malformed value", () => {
  assert.equal(parseOwnedStoragePath("not a url at all", BUCKET), null);
  assert.equal(parseOwnedStoragePath("", BUCKET), null);
});

test("returns null for a well-formed URL with no /public/ storage segment", () => {
  assert.equal(parseOwnedStoragePath("https://xyzcompany.supabase.co/some/other/path.jpg", BUCKET), null);
});
