"use server";

import { cookies } from "next/headers";
import { getMarketById } from "@/lib/markets";
import { MARKET_COOKIE } from "@/lib/activeMarket";

/**
 * Sets the active market cookie. Called from the market selection modal
 * and the auto-detect flow in MarketChip.
 * Only active markets can be set — coming-soon markets are silently ignored.
 */
export async function setMarketAction(marketId: string): Promise<void> {
  const market = getMarketById(marketId);
  if (!market || market.status !== "active") return;

  const cookieStore = await cookies();
  cookieStore.set(MARKET_COOKIE, marketId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
  });
}
