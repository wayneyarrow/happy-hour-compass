import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isOptimizableImageSrc,
  PHOTO_QUALITY,
  SUPABASE_IMAGE_HOST,
  SUPABASE_IMAGE_PATH_PREFIX,
} from "../../../src/lib/imageDelivery";

const BUCKET = `https://${SUPABASE_IMAGE_HOST}${SUPABASE_IMAGE_PATH_PREFIX}`;

test("uploaded photos in the public venue-images bucket are optimized", () => {
  assert.equal(isOptimizableImageSrc(`${BUCKET}venues/abc/photo.jpg`), true);
  assert.equal(isOptimizableImageSrc(`${BUCKET}guides/abc/hero.jpg`), true);
});

test("committed placeholders under /images/ are optimized", () => {
  assert.equal(isOptimizableImageSrc("/images/venues/pub/venue-pic-pub-1.jpg"), true);
  assert.equal(isOptimizableImageSrc("/images/sports-bar-1.jpg"), true);
});

test("anything outside the allowlist is served as the original URL", () => {
  for (const src of [
    "https://example.com/storage/v1/object/public/venue-images/a.jpg",
    `https://${SUPABASE_IMAGE_HOST}/storage/v1/object/public/other-bucket/a.jpg`,
    `https://${SUPABASE_IMAGE_HOST}/storage/v1/object/sign/venue-images/a.jpg`,
    `${BUCKET}venues/a.jpg?token=x`,
    `http://${SUPABASE_IMAGE_HOST}${SUPABASE_IMAGE_PATH_PREFIX}a.jpg`,
    `https://${SUPABASE_IMAGE_HOST}:8443${SUPABASE_IMAGE_PATH_PREFIX}a.jpg`,
    "//example.com/images/a.jpg",
    "/logo.png",
    "data:image/png;base64,AAAA",
    "",
  ]) {
    assert.equal(isOptimizableImageSrc(src), false, src);
  }
});

test("next.config allows exactly the helper's host and bucket, and the photo quality", () => {
  const config = readFileSync(join(__dirname, "../../../next.config.ts"), "utf8");
  assert.match(config, /hostname: SUPABASE_IMAGE_HOST/);
  assert.match(config, /pathname: `\$\{SUPABASE_IMAGE_PATH_PREFIX\}\*\*`/);
  assert.match(config, /search: ""/);
  assert.match(config, /qualities: \[PHOTO_QUALITY, 75\]/);
  assert.ok(PHOTO_QUALITY > 0 && PHOTO_QUALITY <= 100);
});
