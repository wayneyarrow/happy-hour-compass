import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-level guarantees for the streamed public homepage: the header and
 * hero wait only for the Homepage record, Section content resolves inside
 * a Suspense boundary, and metadata never resolves Sections.
 */

const SRC = join(__dirname, "../../../src");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const page = stripComments(readFileSync(join(SRC, "app/(website)/page.tsx"), "utf8"));

const between = (from: string, to: string) => {
  const start = page.indexOf(from);
  assert.ok(start >= 0, `missing ${from}`);
  const end = page.indexOf(to, start + from.length);
  return page.slice(start, end < 0 ? undefined : end);
};

test("metadata uses the Homepage record only", () => {
  const metadata = between("export async function generateMetadata", "export default async function WebsiteHomePage");
  assert.match(metadata, /getPublicHomepageRecordForLocation\(/);
  assert.doesNotMatch(metadata, /resolvePublicHomepageSections|resolveSection/);
});

test("the page awaits only the record before rendering the hero; Sections resolve inside Suspense", () => {
  const body = between("export default async function WebsiteHomePage", "async function HomepageEditorialSections");
  assert.doesNotMatch(body, /resolvePublicHomepageSections|resolveSection/);
  assert.match(body, /<Suspense fallback=\{<HomepageSectionsPlaceholder \/>\}>\s*<HomepageEditorialSections/);
  assert.ok(body.indexOf("<HeroSection") < body.indexOf("<Suspense"), "hero must render outside (before) the Suspense boundary");
  // Discovery tracking keeps the Homepage id for the hero and every Section.
  assert.match(body, /<DiscoveryPageTracking marketId=\{market\.id\} homepageId=\{homepage\?\.id \?\? null\}>/);

  const sections = between("async function HomepageEditorialSections", "function HomepageSectionsWithSignup");
  assert.match(sections, /await resolvePublicHomepageSections\(homepage, marketSlug\)/);
});

test("recognised crawlers get the same Sections rendered in place (no Suspense); both paths sit inside the error boundary", () => {
  const body = between("export default async function WebsiteHomePage", "async function HomepageEditorialSections");
  assert.match(body, /const renderAllAtOnce = userAgent\(\{ headers: await headers\(\) \}\)\.isBot;/);
  assert.match(
    body,
    /<HomepageSectionsErrorBoundary>\s*\{renderAllAtOnce \? \(\s*<HomepageEditorialSections homepage=\{homepage\} marketSlug=\{market\.id\} \/>\s*\) : \(\s*<Suspense fallback=\{<HomepageSectionsPlaceholder \/>\}>\s*<HomepageEditorialSections homepage=\{homepage\} marketSlug=\{market\.id\} \/>\s*<\/Suspense>\s*\)\}\s*<\/HomepageSectionsErrorBoundary>/
  );
});

test("the old all-in-one loader is gone", () => {
  const loader = stripComments(readFileSync(join(SRC, "lib/data/homepagePublic.ts"), "utf8"));
  assert.doesNotMatch(loader + page, /getPublicHomepageForLocation/);
});

test("the placeholder gives way to the browse links: immediately without JavaScript, after a delay when Sections never arrive", () => {
  const placeholder = readFileSync(join(SRC, "app/(website)/homepage/HomepageSectionsPlaceholder.tsx"), "utf8");
  const links = readFileSync(join(SRC, "app/(website)/homepage/HomepageBrowseLinks.tsx"), "utf8");
  for (const href of ["/website-happy-hours", "/website-daily-specials", "/website-events"]) {
    assert.ok(links.includes(`<Link href="${href}"`), `links to ${href}`);
  }
  // Delayed reveal is pure CSS (works when no script runs): links hidden until the delay, then
  // shown while the skeleton hides and the reserved height collapses.
  assert.match(placeholder, /const FALLBACK_DELAY = "10s";/);
  assert.match(placeholder, /"\[data-homepage-sections-fallback\]\{visibility:hidden;animation:hhc-sections-fallback-show 0s " \+ FALLBACK_DELAY \+ " forwards\}"/);
  assert.match(placeholder, /"\[data-homepage-sections-skeleton\]\{animation:hhc-sections-fallback-hide 0s " \+ FALLBACK_DELAY \+ " forwards\}"/);
  assert.match(placeholder, /"\[data-homepage-sections-placeholder\]\{animation:hhc-sections-fallback-collapse 0s " \+ FALLBACK_DELAY \+ " forwards\}"/);
  // Without JavaScript: immediately, with no reserved gap.
  assert.match(placeholder, /<noscript>\s*<style>\{NOSCRIPT_CSS\}<\/style>\s*<\/noscript>/);
  assert.match(placeholder, /"\[data-homepage-sections-placeholder\]\{min-height:0;animation:none\}"/);
  assert.match(placeholder, /"\[data-homepage-sections-skeleton\]\{display:none\}"/);
  assert.match(placeholder, /"\[data-homepage-sections-fallback\]\{visibility:visible;position:static;animation:none\}"/);
  assert.match(placeholder, /<section data-homepage-sections-fallback[^>]*>\s*<HomepageBrowseLinks \/>/);
  // No reduced-motion override anywhere may cancel the (zero-duration) reveal.
  const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
  assert.doesNotMatch(css, /prefers-reduced-motion/);
});
