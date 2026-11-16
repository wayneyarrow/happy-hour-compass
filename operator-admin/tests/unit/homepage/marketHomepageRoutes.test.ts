import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PAGE_MARKET_HEADER,
  ROOT_HOMEPAGE_MARKET_ID,
  getHomepageMarketIdForPath,
  getMarketForHomepageSlug,
  getMarketHomePath,
  getMarketHomepagePaths,
  getPageMarketIdForPath,
} from "../../../src/lib/marketHomepage";
import { buildPageMetadata } from "../../../src/lib/seo/metadata";

/**
 * "/" is always the Central Okanagan (Kelowna) homepage; Greater San Diego's
 * homepage has its own self-canonical URL, /greater-san-diego
 * (src/lib/marketHomepage.ts). Every other page still follows the visitor's
 * saved market, else their country.
 */

const SRC = join(__dirname, "../../../src");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (p: string) => stripComments(readFileSync(join(SRC, p), "utf8"));

test("home paths: Central Okanagan is '/', Greater San Diego is '/greater-san-diego', anything else falls back to '/'", () => {
  assert.equal(ROOT_HOMEPAGE_MARKET_ID, "central-okanagan");
  assert.equal(getMarketHomePath("central-okanagan"), "/");
  assert.equal(getMarketHomePath("greater-san-diego"), "/greater-san-diego");
  for (const id of ["greater-vancouver", "victoria", "calgary", "palm-springs", "nowhere", "", null, undefined, "__proto__", "toString"]) {
    assert.equal(getMarketHomePath(id), "/", String(id));
  }
  assert.deepEqual(getMarketHomepagePaths(), ["/greater-san-diego"]);
});

test("only '/' and '/greater-san-diego' are market homepages", () => {
  assert.equal(getHomepageMarketIdForPath("/"), "central-okanagan");
  assert.equal(getHomepageMarketIdForPath("/greater-san-diego"), "greater-san-diego");
  assert.equal(getHomepageMarketIdForPath("/greater-san-diego/"), "greater-san-diego");
  for (const p of ["/central-okanagan", "/greater-san-diego/guides", "/greater-san-diego/newsletter", "/website-happy-hours", "/greater-vancouver", "", null, undefined]) {
    assert.equal(getHomepageMarketIdForPath(p), null, String(p));
  }
});

test("pages belong to a market from their URL: both homepages and everything under an active market's slug", () => {
  const cases: Array<[string | null | undefined, string | null]> = [
    ["/", "central-okanagan"],
    ["/greater-san-diego", "greater-san-diego"],
    ["/greater-san-diego/la-mesa/la-mesa-aromi-italian", "greater-san-diego"],
    ["/greater-san-diego/san-diego/events/some-event", "greater-san-diego"],
    ["/greater-san-diego/guides/best-taco-tuesday-deals", "greater-san-diego"],
    ["/greater-san-diego/guides", "greater-san-diego"],
    ["/greater-san-diego/collections/featured-guides", "greater-san-diego"],
    ["/greater-san-diego/newsletter", "greater-san-diego"],
    ["/central-okanagan/west-kelowna/19-okanagan-grill-bar", "central-okanagan"],
    ["/central-okanagan/kelowna/events/some-event", "central-okanagan"],
    ["/central-okanagan/guides/downtown-kelowna-happy-hour-guide", "central-okanagan"],
    ["/central-okanagan/collections/featured-guides", "central-okanagan"],
    // Global pages follow the visitor's saved market, else country.
    ["/website-happy-hours", null],
    ["/website-daily-specials", null],
    ["/website-events", null],
    ["/website-events/abc", null],
    ["/weekly-picks", null],
    ["/saved", null],
    ["/account", null],
    ["/about", null],
    // Coming Soon markets keep the visitor's shell around the Coming Soon page.
    ["/greater-vancouver/burnaby/some-venue", null],
    ["/calgary", null],
    ["/palm-springs", null],
    ["/__proto__/x", null],
    ["", null],
    [null, null],
    [undefined, null],
  ];
  for (const [path, market] of cases) assert.equal(getPageMarketIdForPath(path), market, String(path));
});

test("/{slug} serves only Greater San Diego; the root market, Coming Soon markets and unknown slugs 404", () => {
  assert.equal(getMarketForHomepageSlug("greater-san-diego")?.id, "greater-san-diego");
  for (const slug of ["central-okanagan", "greater-vancouver", "victoria", "calgary", "palm-springs", "los-angeles", "nowhere", "__proto__"]) {
    assert.equal(getMarketForHomepageSlug(slug), null, slug);
  }
});

test("each homepage is self-canonical", () => {
  const sd = buildPageMetadata({ title: "t", description: "d", path: "/greater-san-diego" });
  assert.match(String(sd.alternates?.canonical), /\/greater-san-diego$/);
  const root = buildPageMetadata({ title: "t", description: "d", path: "/" });
  assert.doesNotMatch(String(root.alternates?.canonical), /san-diego|central-okanagan/);
});

test("'/' never resolves a market from the visitor; /[market] only from its slug", () => {
  const root = read("app/(website)/page.tsx");
  assert.doesNotMatch(root, /getWebsiteActiveMarket|getWebsiteShellMarket|getActiveMarket|cookies\(|headers\(/);
  assert.match(root, /getMarketById\(ROOT_HOMEPAGE_MARKET_ID\)/);
  assert.match(root, /generateMarketHomepageMetadata\(rootMarket\(\), "\/"\)/);
  assert.match(root, /<MarketHomepage market=\{rootMarket\(\)\} \/>/);

  const market = read("app/(website)/[market]/page.tsx");
  assert.doesNotMatch(market, /getWebsiteActiveMarket|getWebsiteShellMarket|cookies\(|headers\(/);
  assert.match(market, /if \(!market\) notFound\(\);/);
  assert.match(market, /generateMarketHomepageMetadata\(market, getMarketHomePath\(market\.id\)\)/);

  const shared = read("app/(website)/homepage/MarketHomepage.tsx");
  assert.doesNotMatch(shared, /getWebsiteActiveMarket|getWebsiteShellMarket|getActiveMarket/);
  assert.match(shared, /const base = buildPageMetadata\(\{\s*path,/);
});

test("middleware strips any client-sent page-market tag and sets it only on pages that belong to a market", () => {
  const mw = read("middleware.ts");
  const strip = mw.indexOf("request.headers.delete(PAGE_MARKET_HEADER);");
  const set = mw.indexOf("if (pageMarketId) request.headers.set(PAGE_MARKET_HEADER, pageMarketId);");
  const firstNext = mw.indexOf("NextResponse.next({ request })");
  assert.ok(strip > -1 && set > strip && firstNext > set, "strip, then set, before any response is built");
  assert.match(mw, /getPageMarketIdForPath\(request\.nextUrl\.pathname\)/);
  assert.equal(PAGE_MARKET_HEADER, "x-hhc-page-market");
  // Only the layout reads it (through getWebsiteShellMarket).
  assert.match(read("lib/activeMarket.ts"), /\(await headers\(\)\)\.get\(PAGE_MARKET_HEADER\)/);
  // Read raw: the comment stripper above mis-parses this file's JSX comments.
  assert.match(readFileSync(join(SRC, "app/(website)/layout.tsx"), "utf8"), /const \{ market \} = await getWebsiteShellMarket\(\);/);
});

test("home navigation goes to the page's own market homepage", () => {
  assert.match(read("app/(website)/WebsiteHeader.tsx"), /href=\{getMarketHomePath\(marketId\)\}\s*aria-label="Happy Hour Compass — Home"/);
  const footer = read("app/(website)/WebsiteFooter.tsx");
  assert.match(footer, /href=\{getMarketHomePath\(marketId\)\}\s*aria-label="Happy Hour Compass — Home"/);
  assert.match(footer, /router\.push\(getMarketHomePath\(marketId\)\);/);
  // Active markets in the footer are real, crawlable links to their homepages.
  assert.match(footer, /<FooterMarketLink\s*href=\{getMarketHomePath\(market\.id\)\}/);
  assert.match(footer, /<a\s*href=\{href\}/);

  const switcher = read("app/(website)/WebsiteLocationSwitcher.tsx");
  assert.match(switcher, /const onMarketPage = getPageMarketIdForPath\(pathname\) !== null;/);
  assert.match(switcher, /if \(onMarketPage\) router\.push\(getMarketHomePath\(nextMarketId\)\);/);
  assert.equal((switcher.match(/showMarket\(/g) ?? []).length, 3, "region choice and Use My Location both go through showMarket");

  for (const [file, expr] of [
    ["app/(website)/[market]/[city]/[slug]/page.tsx", "venue.marketSlug"],
    ["app/(website)/[market]/guides/[slug]/page.tsx", "guide.marketSlug"],
    ["app/(website)/[market]/guides/[slug]/GuideDetailView.tsx", "guide.marketSlug"],
    ["app/(website)/[market]/collections/[slug]/page.tsx", "model.marketSlug"],
    ["app/(website)/website-events/[id]/EventDetailContent.tsx", "event.venueMarketSlug"],
    ["app/(website)/collections/CollectionBreadcrumb.tsx", "marketSlug"],
  ] as const) {
    assert.ok(read(file).includes(`getMarketHomePath(${expr})`), file);
  }
});

test("the sitemap lists every market homepage URL", () => {
  const sitemap = read("app/sitemap.ts");
  assert.match(sitemap, /\{ url: absoluteUrl\("\/"\) \},\s*\.\.\.getMarketHomepagePaths\(\)\.map\(\(path\) => \(\{ url: absoluteUrl\(path\) \}\)\),/);
});
