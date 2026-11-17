import { DEFAULT_MARKET_ID, getMarketById, type Market } from "@/lib/markets";
import { getDiscoveryDestination, getMarketListingModeForPath } from "@/lib/homepageDiscoveryModes";

/**
 * Where each active market's public homepage lives. Client-safe (no server
 * imports): the header, footer, location switcher and breadcrumbs all use it.
 *
 * "/" is Central Okanagan's homepage, always: same Kelowna homepage, title
 * and canonical for every visitor, whatever their country or saved market.
 * Before this, "/" picked a market per visitor (saved choice, else country),
 * so US visitors, and Googlebot crawling from US IPs, got the San Diego
 * homepage on the URL that carries Kelowna's rankings.
 *
 * Every other active market gets its own self-canonical homepage URL.
 * /greater-san-diego is ((website)/[market]/page.tsx), the same Homepage CMS
 * record and sections that "/" used to show US visitors.
 *
 * These two URLs, and every page under an active market's slug
 * (getPageMarketIdForPath), belong to one market. The website header and
 * footer work out their market from the current URL in the browser
 * (WebsiteShellChrome.tsx), so they follow the page on every navigation,
 * including client-side navigation where the shared layout isn't
 * re-rendered. Every other page (the legacy /website-… listings, account
 * pages) follows the visitor's saved market, else their country
 * (getWebsiteActiveMarket()).
 *
 * /central-okanagan is deliberately not a homepage URL yet. It 404s as
 * before; whether it should exist, and which of it and "/" is canonical,
 * is a follow-up decision once Search Console shows where Kelowna ranks.
 */

/** The market "/" always shows. */
export const ROOT_HOMEPAGE_MARKET_ID = DEFAULT_MARKET_ID;

/** Active markets with their own homepage URL, by market id → path. */
const MARKET_HOMEPAGE_PATHS: Readonly<Record<string, string>> = {
  "greater-san-diego": "/greater-san-diego",
};

/** The homepage URL for `marketId`; "/" for the root market and anything without its own homepage. */
export function getMarketHomePath(marketId: string | null | undefined): string {
  if (!marketId || !Object.prototype.hasOwnProperty.call(MARKET_HOMEPAGE_PATHS, marketId)) return "/";
  const market = getMarketById(marketId);
  return market?.status === "active" ? MARKET_HOMEPAGE_PATHS[marketId] : "/";
}

/** The market whose homepage is at `pathname`, or null when it isn't a market homepage. */
export function getHomepageMarketIdForPath(pathname: string | null | undefined): string | null {
  if (pathname === "/") return ROOT_HOMEPAGE_MARKET_ID;
  if (!pathname) return null;
  const normalized = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  for (const id of Object.keys(MARKET_HOMEPAGE_PATHS)) {
    if (getMarketHomePath(id) === normalized) return id;
  }
  return null;
}

/**
 * The market a page belongs to, from its URL alone, or null for pages that
 * follow the visitor's market (global listing pages, account pages, etc.):
 *   - a market homepage ("/" → Central Okanagan, "/greater-san-diego"), or
 *   - any page under an active market's slug: venue, event, guide, guide
 *     index, collection and newsletter pages (/central-okanagan/kelowna/…,
 *     /greater-san-diego/guides/…).
 * Coming Soon markets are excluded: their URLs render the branded Coming
 * Soon page inside the visitor's own shell, as before.
 *
 * The website header and footer use this, from the browser's current URL,
 * to show the page's market rather than the visitor's (WebsiteShellChrome).
 */
export function getPageMarketIdForPath(pathname: string | null | undefined): string | null {
  const homepageMarketId = getHomepageMarketIdForPath(pathname);
  if (homepageMarketId) return homepageMarketId;
  const firstSegment = pathname?.split("/")[1];
  if (!firstSegment) return null;
  const market = getMarketById(firstSegment);
  return market?.status === "active" ? market.id : null;
}

/**
 * Where the location switcher takes a visitor who picks `nextMarketId` while
 * on `pathname`: the same listing in the new market from a market listing
 * URL (/central-okanagan/events → /greater-san-diego/events), else the new
 * market's homepage. Only used on pages that belong to a market; other pages
 * stay put and refresh.
 */
export function getMarketSwitchPath(pathname: string | null | undefined, nextMarketId: string): string {
  const listingMode = getMarketListingModeForPath(pathname);
  return listingMode ? getDiscoveryDestination(listingMode, nextMarketId) : getMarketHomePath(nextMarketId);
}

/** The active market served at /{slug} as its own homepage, or null (→ 404). */
export function getMarketForHomepageSlug(slug: string): Market | null {
  const id = getHomepageMarketIdForPath(`/${slug}`);
  if (!id || id === ROOT_HOMEPAGE_MARKET_ID) return null;
  const market = getMarketById(id);
  return market && market.status === "active" ? market : null;
}

/** Every market homepage URL other than "/" (for the sitemap). */
export function getMarketHomepagePaths(): string[] {
  return Object.keys(MARKET_HOMEPAGE_PATHS)
    .map((id) => getMarketHomePath(id))
    .filter((p) => p !== "/");
}
