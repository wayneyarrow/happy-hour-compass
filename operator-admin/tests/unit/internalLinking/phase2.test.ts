import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  selectVenueFeaturedGuideLinks,
  getPublicGuidesFeaturingVenue,
  VENUE_FEATURED_GUIDES_LIMIT,
  type VenueFeaturedGuideRow,
} from "../../../src/lib/data/venueFeaturedGuides";

/**
 * Internal Linking Phase 2: venue-page "Featured in" guide links and the
 * "Browse more happy hours" link.
 */

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MARKET = "central-okanagan";
const DAY = 24 * 60 * 60 * 1000;
const past = (days = 1) => new Date(Date.now() - days * DAY).toISOString();
const future = new Date(Date.now() + DAY).toISOString();

const row = (over: Partial<VenueFeaturedGuideRow> = {}): VenueFeaturedGuideRow => ({
  title: "Guide",
  slug: "guide",
  status: "published",
  guide_type: "venue_guide",
  publish_at: null,
  expire_at: null,
  hero_image_url: null,
  markets: { slug: MARKET },
  ...over,
});

test("eligible guides link to their canonical /{market}/guides/{slug} path", () => {
  const links = selectVenueFeaturedGuideLinks(
    [row({ title: "Patios", slug: "patios", hero_image_url: "https://img.example/patios.jpg" }), row({ title: "Plain", slug: "plain" })],
    MARKET
  );
  assert.deepEqual(links, [
    { href: "/central-okanagan/guides/patios", title: "Patios", heroImageUrl: "https://img.example/patios.jpg" },
    { href: "/central-okanagan/guides/plain", title: "Plain", heroImageUrl: null },
  ]);
});

test("draft, future, expired, other-market and event guides are excluded", () => {
  const links = selectVenueFeaturedGuideLinks(
    [
      row({ slug: "draft", status: "draft" }),
      row({ slug: "future", publish_at: future }),
      row({ slug: "expired", expire_at: past() }),
      row({ slug: "other-market", markets: { slug: "greater-vancouver" } }),
      row({ slug: "no-market", markets: null }),
      row({ slug: "event", guide_type: "event_guide" }),
      row({ slug: "ok", publish_at: past(), expire_at: future }),
    ],
    MARKET
  );
  assert.deepEqual(links.map((l) => l.href), ["/central-okanagan/guides/ok"]);
});

test("no eligible guides yields an empty list (section not rendered)", () => {
  assert.deepEqual(selectVenueFeaturedGuideLinks([], MARKET), []);
  assert.deepEqual(selectVenueFeaturedGuideLinks([row({ status: "draft" })], MARKET), []);
});

test("order: newest publish_at first, undated last, then title; capped", () => {
  const links = selectVenueFeaturedGuideLinks(
    [
      row({ title: "B undated", slug: "b" }),
      row({ title: "Older", slug: "older", publish_at: past(10) }),
      row({ title: "A undated", slug: "a" }),
      row({ title: "Newer", slug: "newer", publish_at: past(2) }),
    ],
    MARKET
  );
  assert.deepEqual(links.map((l) => l.title), ["Newer", "Older", "A undated", "B undated"]);
  const many = Array.from({ length: 10 }, (_, i) => row({ title: `G${i}`, slug: `g${i}` }));
  assert.equal(selectVenueFeaturedGuideLinks(many, MARKET).length, VENUE_FEATURED_GUIDES_LIMIT);
});

test("a venue with no market never queries and returns no links", async () => {
  assert.deepEqual(await getPublicGuidesFeaturingVenue("00000000-0000-0000-0000-000000000000", null), []);
});

test("helper is one structured-attachment query that fails closed to []", () => {
  const src = read("src/lib/data/venueFeaturedGuides.ts");
  assert.equal((src.match(/\.from\(/g) ?? []).length, 1, "one query");
  assert.match(src, /content_guide_venues!inner\(venue_id\)/);
  assert.match(src, /\.eq\("content_guide_venues\.venue_id", venueUuid\)/);
  assert.match(src, /\.eq\("status", "published"\)/);
  assert.match(src, /isGuidePublicNow/);
  assert.ok(!/getVenueFeaturedContent\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "not the CP helper");
  assert.match(src, /if \(error\) \{[\s\S]*?return \[\];/);
  assert.match(src, /catch \(err\) \{[\s\S]*?return \[\];/);
});

test("venue page renders Featured in only when non-empty, plus the Browse more link", () => {
  const page = read("src/app/(website)/[market]/[city]/[slug]/page.tsx");
  assert.equal((page.match(/getPublicGuidesFeaturingVenue\(/g) ?? []).length, 1);
  assert.match(page, /\{featuredGuides\.length > 0 && \(\s*<section id="featured-in"/);
  assert.match(page, /href=\{guide\.href\}/);
  const section = page.slice(page.indexOf('<section id="featured-in"'), page.indexOf("{/* ── Business Info"));
  assert.match(section, /\{guide\.heroImageUrl && \(/, "thumbnail only when an image exists");
  assert.equal((section.match(/<Link\b/g) ?? []).length, 1, "one link per card");
  assert.ok(!/<(button|a)\b/.test(section), "no nested interactive controls");
  assert.match(page, /href=\{DISCOVERY_MODES\.happy_hours\.destination\}[\s\S]{0,400}Browse more happy hours/);
});
