import { cookies, headers } from "next/headers";
import {
  getMarketById,
  getDefaultMarket,
  getDefaultMarketForCountry,
  type Market,
} from "./markets";
import { HOMEPAGE_ROUTE_MARKET_HEADER } from "./marketHomepage";

export const MARKET_COOKIE = "hhc_market";

export type ActiveMarketResult = {
  market: Market;
  /** True when the user has a persisted manual or auto-detected market cookie. */
  isPersisted: boolean;
};

/**
 * Reads the active market from the request cookie.
 * Falls back to the default market (Central Okanagan) when no valid cookie exists.
 * Server-only — imports next/headers.
 */
export async function getActiveMarket(): Promise<ActiveMarketResult> {
  const cookieStore = await cookies();
  const marketId = cookieStore.get(MARKET_COOKIE)?.value;
  if (marketId) {
    const market = getMarketById(marketId);
    if (market?.status === "active") {
      return { market, isPersisted: true };
    }
  }
  return { market: getDefaultMarket(), isPersisted: false };
}

/**
 * Public website market resolution:
 *   1. The visitor's explicit choice — the hhc_market cookie, which only
 *      setMarketAction writes (header/footer selector, "Use my location").
 *   2. First visit, no choice yet: by visitor country — US → Greater San
 *      Diego; Canada, elsewhere, or unknown → Central Okanagan
 *      (getDefaultMarketForCountry). Never persisted, so it never outranks
 *      a later explicit choice and is re-evaluated on each visit until one
 *      is made.
 *
 * The consumer app keeps getActiveMarket() (cookie or Central Okanagan).
 * Server-only — imports next/headers.
 */
export async function getWebsiteActiveMarket(): Promise<ActiveMarketResult> {
  const chosen = await getActiveMarket();
  if (chosen.isPersisted) return chosen;
  return { market: getDefaultMarketForCountry(await getVisitorCountry()), isPersisted: false };
}

/**
 * The market the website shell (header, footer) should show for this
 * request. On a market homepage URL ("/" → Central Okanagan,
 * "/greater-san-diego" → Greater San Diego; src/lib/marketHomepage.ts) it
 * is that page's own market, which middleware tags on the request
 * (HOMEPAGE_ROUTE_MARKET_HEADER), whatever the visitor's saved market or
 * country. Everywhere else it is exactly getWebsiteActiveMarket().
 * Never persisted. Server-only — imports next/headers.
 */
export async function getWebsiteShellMarket(): Promise<ActiveMarketResult> {
  try {
    const routeMarketId = (await headers()).get(HOMEPAGE_ROUTE_MARKET_HEADER);
    const routeMarket = routeMarketId ? getMarketById(routeMarketId) : undefined;
    if (routeMarket?.status === "active") return { market: routeMarket, isPersisted: false };
  } catch {
    // No request headers (e.g. build-time) — fall through.
  }
  return getWebsiteActiveMarket();
}

/**
 * The visitor's country (ISO alpha-2) from Vercel's edge geolocation
 * header, or null when unknown. Trusted only on Vercel (VERCEL=1), where
 * the edge sets it — the same rule claim auto-approval uses
 * (src/lib/claims/claimAutoApprovalSignals.ts). Off Vercel the header is
 * client-controlled, so it's ignored unless HHC_TRUST_GEO_HEADERS_FOR_QA=1
 * (local QA only — never set on a deployment).
 */
export async function getVisitorCountry(): Promise<string | null> {
  const trusted = process.env.VERCEL === "1" || process.env.HHC_TRUST_GEO_HEADERS_FOR_QA === "1";
  if (!trusted) return null;
  try {
    const country = (await headers()).get("x-vercel-ip-country")?.trim();
    return country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null;
  } catch {
    return null;
  }
}
