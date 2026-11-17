import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getMarketSwitchPath,
  ROOT_HOMEPAGE_MARKET_ID,
  getHomepageMarketIdForPath,
  getMarketForHomepageSlug,
  getMarketHomePath,
  getMarketHomepagePaths,
  getPageMarketIdForPath,
} from "../../../src/lib/marketHomepage";
import { buildPageMetadata } from "../../../src/lib/seo/metadata";
import { getDiscoveryDestination, getMarketListingModeForPath } from "../../../src/lib/homepageDiscoveryModes";
import { getListingMarketForSlug } from "../../../src/lib/seo/marketListingMetadata";

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

test("the header and footer follow the page's market from the browser URL, so they survive client-side navigation", () => {
  // No per-request tag: Next keeps the shared layout on client-side navigation, so a tag would stick to the previous page.
  const mw = read("middleware.ts");
  assert.doesNotMatch(mw, /marketHomepage|x-hhc-page-market|getPageMarketIdForPath/);
  assert.doesNotMatch(read("lib/activeMarket.ts"), /getWebsiteShellMarket|x-hhc-page-market/);

  const layout = readFileSync(join(SRC, "app/(website)/layout.tsx"), "utf8");
  assert.match(layout, /const \{ market \} = await getWebsiteActiveMarket\(\);/);
  assert.match(layout, /MARKETS\.filter\(\(m\) => m\.status === "active"\)\.map\(\(m\) => getShellMarketData\(m\)\)/);
  assert.match(layout, /<WebsiteShellHeader markets=\{shellMarkets\} visitorMarketId=\{market\.id\} consumerUser=\{consumerUser\} \/>/);
  assert.match(layout, /<WebsiteShellFooter markets=\{shellMarkets\} visitorMarketId=\{market\.id\} \/>/);
  assert.doesNotMatch(layout, /<WebsiteHeader\b|<WebsiteFooter\b/);

  const chrome = read("app/(website)/WebsiteShellChrome.tsx");
  assert.match(chrome, /const pathname = usePathname\(\);\s*const id = getPageMarketIdForPath\(pathname\) \?\? visitorMarketId;/);
});

test("market listing URLs: /{active-market}/happy-hours, /daily-specials, /events", () => {
  assert.equal(getDiscoveryDestination("happy_hours", "central-okanagan"), "/central-okanagan/happy-hours");
  assert.equal(getDiscoveryDestination("daily_specials", "greater-san-diego"), "/greater-san-diego/daily-specials");
  assert.equal(getDiscoveryDestination("events", "greater-san-diego"), "/greater-san-diego/events");
  // No (or no active) market: the legacy route.
  for (const id of [null, undefined, "", "greater-vancouver", "palm-springs", "__proto__"]) {
    assert.equal(getDiscoveryDestination("happy_hours", id), "/website-happy-hours", String(id));
    assert.equal(getDiscoveryDestination("events", id), "/website-events", String(id));
  }
  assert.equal(getMarketListingModeForPath("/central-okanagan/happy-hours"), "happy_hours");
  assert.equal(getMarketListingModeForPath("/greater-san-diego/daily-specials"), "daily_specials");
  assert.equal(getMarketListingModeForPath("/greater-san-diego/events"), "events");
  for (const p of ["/website-happy-hours", "/greater-vancouver/events", "/greater-san-diego/san-diego/events/x", "/greater-san-diego", "/", null]) {
    assert.equal(getMarketListingModeForPath(p), null, String(p));
  }
  assert.equal(getListingMarketForSlug("central-okanagan")?.id, "central-okanagan");
  assert.equal(getListingMarketForSlug("greater-san-diego")?.id, "greater-san-diego");
  for (const slug of ["greater-vancouver", "victoria", "palm-springs", "nowhere"]) assert.equal(getListingMarketForSlug(slug), null, slug);
  // They belong to their market, so the header follows them.
  assert.equal(getPageMarketIdForPath("/central-okanagan/happy-hours"), "central-okanagan");
  assert.equal(getPageMarketIdForPath("/greater-san-diego/events"), "greater-san-diego");
});

test("switching market keeps the visitor on the same kind of page", () => {
  assert.equal(getMarketSwitchPath("/central-okanagan/happy-hours", "greater-san-diego"), "/greater-san-diego/happy-hours");
  assert.equal(getMarketSwitchPath("/greater-san-diego/events", "central-okanagan"), "/central-okanagan/events");
  assert.equal(getMarketSwitchPath("/greater-san-diego/daily-specials", "central-okanagan"), "/central-okanagan/daily-specials");
  assert.equal(getMarketSwitchPath("/greater-san-diego/la-mesa/la-mesa-aromi-italian", "central-okanagan"), "/");
  assert.equal(getMarketSwitchPath("/", "greater-san-diego"), "/greater-san-diego");
});

test("market listing routes: own market only, self-canonical metadata, shared listing bodies", () => {
  for (const [dir, mode] of [["happy-hours", "happy_hours"], ["daily-specials", "daily_specials"], ["events", "events"]] as const) {
    const page = read(`app/(website)/[market]/${dir}/page.tsx`);
    assert.match(page, /const market = getListingMarketForSlug\(\(await params\)\.market\);\s*if \(!market\) notFound\(\);/, dir);
    assert.match(page, new RegExp(`buildMarketListingMetadata\\("${mode}", market\\)`), dir);
    assert.doesNotMatch(page, /getWebsiteActiveMarket|cookies\(|setMarketAction/, dir);
  }
  assert.match(read("app/(website)/[market]/happy-hours/page.tsx"), /<HappyHoursListing market=\{market\} searchParams=\{searchParams\} \/>/);
  assert.match(read("app/(website)/website-happy-hours/page.tsx"), /const \{ market \} = await getWebsiteActiveMarket\(\);\s*return <HappyHoursListing market=\{market\} searchParams=\{searchParams\} \/>;/);
  const meta = read("lib/seo/marketListingMetadata.ts");
  assert.match(meta, /return buildPageMetadata\(\{\s*title: copy\.title\(place\),\s*description: copy\.description\(place\),\s*path: getDiscoveryDestination\(mode, market\.id\),/);
});

test("links on market pages open that market's listings", () => {
  const hero = read("app/(website)/HeroSection.tsx");
  assert.match(hero, /const browseHref = getDiscoveryDestination\(discoveryMode, market\.id\);/);
  assert.match(hero, /href=\{browseHref\}/);
  assert.match(read("app/(website)/HeroDiscoverySearch.tsx"), /getDiscoveryDestination\(mode, market\.id\)/);
  assert.match(read("app/(website)/siteDiscoveryLinks.ts"), /href: getDiscoveryDestination\(mode, marketId\),/);
  for (const f of ["app/(website)/WebsiteHeader.tsx", "app/(website)/WebsiteFooter.tsx"]) {
    assert.match(read(f), /buildSiteDiscoveryLinks\(featuredGuidesHref, marketId\)/, f);
  }
  assert.match(read("lib/data/homepagesRendering.ts"), /viewAllHref: `\$\{getDiscoveryDestination\("daily_specials", marketSlug\)\}\?when=today`/);
  assert.match(read("app/(website)/[market]/guides/[slug]/GuideDetailView.tsx"), /getDiscoveryDestination\(isVenueGuide \? "happy_hours" : "events", guide\.marketSlug\)/);
  const collections = read("app/(website)/collections/CollectionTypeContent.tsx");
  assert.match(collections, /getDiscoveryDestination\("happy_hours", market\.id\)/);
  assert.match(collections, /getDiscoveryDestination\("events", market\.id\)/);
  assert.match(read("app/(website)/weekly-picks/NewsletterConfirmedContent.tsx"), /getDiscoveryDestination\("happy_hours", newsletter\.marketId\)/);
});

test("visiting market pages never writes the saved market", () => {
  for (const f of ["middleware.ts", "app/(website)/layout.tsx", "app/(website)/WebsiteShellChrome.tsx", "lib/seo/marketListingMetadata.ts"]) {
    assert.doesNotMatch(read(f), /hhc_market|MARKET_COOKIE|setMarketAction/, f);
  }
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
  assert.match(switcher, /if \(onMarketPage\) router\.push\(getMarketSwitchPath\(pathname, nextMarketId\)\);/);
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

test("the sitemap lists every market homepage URL and every market listing URL", () => {
  const sitemap = read("app/sitemap.ts");
  assert.match(sitemap, /\.\.\.activeMarketSlugs\.flatMap\(\(marketSlug\) =>\s*DISCOVERY_MODE_ORDER\.map\(\(mode\) => \(\{ url: absoluteUrl\(getDiscoveryDestination\(mode, marketSlug\)\) \}\)\)\s*\),/);
  assert.match(sitemap, /\{ url: absoluteUrl\("\/"\) \},\s*\.\.\.getMarketHomepagePaths\(\)\.map\(\(path\) => \(\{ url: absoluteUrl\(path\) \}\)\),/);
});
