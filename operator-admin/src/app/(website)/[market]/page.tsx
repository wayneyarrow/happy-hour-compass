import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMarketForHomepageSlug, getMarketHomePath } from "@/lib/marketHomepage";
import { MarketHomepage, generateMarketHomepageMetadata } from "../homepage/MarketHomepage";

/**
 * A market's own homepage URL, e.g. /greater-san-diego: the same Homepage
 * CMS record, sections and SEO fields "/" used to show that market's
 * visitors, at a self-canonical URL (src/lib/marketHomepage.ts). Only
 * markets listed there are served. Everything else 404s, as before this
 * route existed: the root market (Central Okanagan lives at "/";
 * /central-okanagan is a follow-up decision), Coming Soon markets, and
 * unknown slugs.
 */

type PageProps = { params: Promise<{ market: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const market = getMarketForHomepageSlug((await params).market);
  if (!market) return {};
  return generateMarketHomepageMetadata(market, getMarketHomePath(market.id));
}

export default async function MarketHomepagePage({ params }: PageProps) {
  const market = getMarketForHomepageSlug((await params).market);
  if (!market) notFound();
  return <MarketHomepage market={market} />;
}
