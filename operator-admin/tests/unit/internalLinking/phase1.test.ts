import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveFeaturedGuidesNavHref } from "../../../src/lib/data/featuredGuidesNav";
import { isLinkedVenueUnpublished } from "../../../src/lib/data/events";
import { buildSiteDiscoveryLinks } from "../../../src/app/(website)/siteDiscoveryLinks";

/**
 * Internal Linking Phase 1: header/footer discovery links, the Featured
 * Guides availability safeguard, clickable venue-page event cards, and the
 * unpublished-venue event guard.
 */

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const HREF = "/central-okanagan/collections/featured-guides";
const DAY = 24 * 60 * 60 * 1000;
const past = new Date(Date.now() - DAY).toISOString();
const future = new Date(Date.now() + DAY).toISOString();
const guide = (status: string, publish_at: string | null = null, expire_at: string | null = null) => ({
  guide: { status, publish_at, expire_at },
});

// ── Featured Guides availability ────────────────────────────────────────────

test("Guides link resolves to the market's Featured Guides collection when a guide is public", () => {
  const row = { collection_type: "guide", collection_guide_items: [guide("draft"), guide("published")] };
  assert.equal(resolveFeaturedGuidesNavHref("central-okanagan", row), HREF);
});

test("Guides link is omitted when the collection is missing, unpublished or archived (query returned no row)", () => {
  assert.equal(resolveFeaturedGuidesNavHref("central-okanagan", null), null);
});

test("Guides link is omitted when the collection has no guides", () => {
  assert.equal(resolveFeaturedGuidesNavHref("central-okanagan", { collection_type: "guide", collection_guide_items: [] }), null);
  assert.equal(resolveFeaturedGuidesNavHref("central-okanagan", { collection_type: "guide", collection_guide_items: null }), null);
});

test("Guides link is omitted when no attached guide is publicly eligible", () => {
  const row = {
    collection_type: "guide",
    collection_guide_items: [
      guide("draft"),
      guide("published", future, null), // not yet live
      guide("published", null, past), // expired
      { guide: null }, // deleted / unreadable
    ],
  };
  assert.equal(resolveFeaturedGuidesNavHref("central-okanagan", row), null);
});

test("Guides link honours an in-window publish/expire range", () => {
  const row = { collection_type: "guide", collection_guide_items: [guide("published", past, future)] };
  assert.equal(resolveFeaturedGuidesNavHref("central-okanagan", row), HREF);
});

test("Guides link requires a guide-type collection", () => {
  const row = { collection_type: "venue", collection_guide_items: [guide("published")] };
  assert.equal(resolveFeaturedGuidesNavHref("central-okanagan", row), null);
});

test("availability query mirrors the collection page's gates in a single read", () => {
  const src = read("src/lib/data/featuredGuidesNav.ts");
  assert.match(src, /\.eq\("market_id", marketId\)/);
  assert.match(src, /\.eq\("slug", FEATURED_GUIDES_COLLECTION_SLUG\)/);
  assert.match(src, /\.eq\("status", "published"\)/);
  assert.match(src, /\.is\("archived_at", null\)/);
  assert.match(src, /isGuidePublicNow/);
  assert.equal((src.match(/\.from\(/g) ?? []).length, 1, "one query only");
});

// ── Discovery links ─────────────────────────────────────────────────────────

test("discovery links use the Hero's canonical destinations and add Guides only when available", () => {
  assert.deepEqual(buildSiteDiscoveryLinks(null), [
    { href: "/website-happy-hours", label: "Happy Hours" },
    { href: "/website-daily-specials", label: "Daily Specials" },
    { href: "/website-events", label: "Events" },
  ]);
  const withGuides = buildSiteDiscoveryLinks(HREF);
  assert.deepEqual(withGuides.at(-1), { href: HREF, label: "Guides" });
  assert.ok(!withGuides.some((l) => /\/guides$/.test(l.href)), "never the dormant Guides Library");
});

test("layout resolves the Guides href once and shares it with header and footer", () => {
  const layout = read("src/app/(website)/layout.tsx");
  assert.equal((layout.match(/getFeaturedGuidesNavHref\(/g) ?? []).length, 1);
  assert.match(layout, /<WebsiteHeader[\s\S]*featuredGuidesHref=\{featuredGuidesHref\}/);
  assert.match(layout, /<WebsiteFooter featuredGuidesHref=\{featuredGuidesHref\} \/>/);
});

test("Suggest a Venue / Add Your Venue left the desktop header but keep their modals", () => {
  const header = read("src/app/(website)/WebsiteHeader.tsx");
  const desktopNav = header.slice(header.indexOf('aria-label="Main navigation"'), header.indexOf("{/* Mobile — saved icon"));
  assert.ok(!desktopNav.includes("setSuggestOpen(true)"));
  assert.ok(!desktopNav.includes("setAddVenueOpen(true)"));
  const mobileNav = header.slice(header.indexOf('aria-label="Mobile navigation"'));
  assert.ok(mobileNav.indexOf("discoveryLinks.map") < mobileNav.indexOf("Suggest a Venue"), "discovery first on mobile");
  assert.ok(mobileNav.includes("setAddVenueOpen(true)"));
  const footer = read("src/app/(website)/WebsiteFooter.tsx");
  assert.match(footer, /setSuggestOpen\(true\)\}>Suggest a Venue/);
  assert.match(footer, /setAddVenueOpen\(true\)\}>Add Your Venue/);
  assert.match(footer, /<FooterColumnHeading>Explore<\/FooterColumnHeading>/);
});

// ── Venue-page event cards ──────────────────────────────────────────────────

test("venue-page event cards link to the canonical event URL with no extra query", () => {
  const page = read("src/app/(website)/[market]/[city]/[slug]/page.tsx");
  const section = page.slice(page.indexOf("{venue.events.map("), page.indexOf("{/* ── About"));
  assert.match(section, /<Link\s+key=\{event\.id\}/);
  assert.match(section, /eventSlug: event\.slug/);
  assert.match(section, /\?\? `\/website-events\/\$\{event\.id\}`/);
  assert.ok(!/<(button|a)\b/.test(section), "no nested interactive controls");
  const events = read("src/lib/data/events.ts");
  const fn = events.slice(events.indexOf("export async function getEventsForConsumerVenues"));
  assert.match(fn.slice(0, 600), /"id, slug, venue_id, title/);
});

// ── Unpublished-venue event guard ───────────────────────────────────────────

test("isLinkedVenueUnpublished only flags an explicitly unpublished venue", () => {
  assert.equal(isLinkedVenueUnpublished({ is_published: false }), true);
  assert.equal(isLinkedVenueUnpublished({ is_published: true }), false);
  assert.equal(isLinkedVenueUnpublished(null), false, "no linked venue keeps existing behaviour");
  assert.equal(isLinkedVenueUnpublished(undefined), false);
  assert.equal(isLinkedVenueUnpublished({}), false);
});

test("public website event reads apply the venue-publication guard; consumer/sitemap reads are untouched", () => {
  const src = read("src/lib/data/events.ts");
  const body = (name: string) => {
    const start = src.indexOf(`function ${name}(`);
    const next = src.indexOf("\nexport ", start + 1);
    return src.slice(start, next === -1 ? undefined : next);
  };
  for (const name of ["getPublishedEventsForWebsite", "getPublishedEventsByIds", "getEventPreviewsByIds"]) {
    const b = body(name);
    assert.match(b, /venues\(name, is_published,/, `${name} selects venue publication`);
    assert.match(b, /isLinkedVenueUnpublished\(/, `${name} filters on it`);
  }
  const detail = body("getEventForWebsiteByField");
  assert.match(detail, /"id, slug, name, is_published,/);
  assert.match(detail, /!isPreview && isLinkedVenueUnpublished\(/, "detail 404s outside preview");
  assert.ok(!/isLinkedVenueUnpublished/.test(body("getPublishedEventsForConsumer")));
  assert.ok(!/isLinkedVenueUnpublished/.test(body("getEventForConsumerById")));
});
