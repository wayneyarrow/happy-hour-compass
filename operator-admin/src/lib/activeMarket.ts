import { cookies } from "next/headers";
import { getMarketById, getDefaultMarket, type Market } from "./markets";

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
