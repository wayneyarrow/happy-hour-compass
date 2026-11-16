import type { Metadata } from "next";
import { getMarketById } from "@/lib/markets";
import { ROOT_HOMEPAGE_MARKET_ID } from "@/lib/marketHomepage";
import { MarketHomepage, generateMarketHomepageMetadata } from "./homepage/MarketHomepage";

/**
 * "/" is always the Central Okanagan (Kelowna) homepage: same content, title
 * and self-canonical "/" for every visitor and crawler, regardless of
 * country or saved market. Other markets have their own homepage URL
 * (src/lib/marketHomepage.ts; /greater-san-diego → [market]/page.tsx).
 * Rendering lives in homepage/MarketHomepage.tsx, shared by both routes.
 */

const rootMarket = () => getMarketById(ROOT_HOMEPAGE_MARKET_ID)!;

export async function generateMetadata(): Promise<Metadata> {
  return generateMarketHomepageMetadata(rootMarket(), "/");
}

export default async function WebsiteHomePage() {
  return <MarketHomepage market={rootMarket()} />;
}
