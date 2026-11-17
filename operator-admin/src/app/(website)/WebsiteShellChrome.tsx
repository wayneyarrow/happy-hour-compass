"use client";

import { usePathname } from "next/navigation";
import WebsiteHeader, { type ConsumerUser } from "./WebsiteHeader";
import { WebsiteFooter } from "./WebsiteFooter";
import { getPageMarketIdForPath } from "@/lib/marketHomepage";
import type { CityRecord } from "@/lib/geo/types";

/**
 * The website header and footer, showing the market of the page being
 * viewed.
 *
 * A page under a market's URL (the homepages "/" and "/greater-san-diego",
 * /{market}/happy-hours and the other listings, venue, event, guide and
 * collection pages) shows that market; every other page shows the
 * visitor's market (saved choice, else country), which the layout resolves
 * per request.
 *
 * Why the market is worked out here, from the browser's current URL: on
 * client-side navigation Next keeps the shared (website) layout and only
 * renders the new page, so anything the layout decided per request (e.g.
 * "this is a Kelowna page") would stick to the previous page. usePathname()
 * updates on every navigation, so the header always matches the page. The
 * layout sends the shell data for every active market up front (there are
 * two), so switching between them needs no extra request.
 */

export type ShellMarketData = {
  marketId: string;
  marketName: string;
  currentCityName: string;
  cities: CityRecord[];
  featuredGuidesHref: string | null;
  newsletterHref: string | null;
};

type ShellProps = {
  /** Shell data for every active market. */
  markets: ShellMarketData[];
  /** The visitor's market (saved choice, else country), for pages that don't belong to a market. */
  visitorMarketId: string;
};

/** The shell market for the current URL: the page's own market, else the visitor's. */
export function useShellMarket({ markets, visitorMarketId }: ShellProps): ShellMarketData {
  const pathname = usePathname();
  const id = getPageMarketIdForPath(pathname) ?? visitorMarketId;
  return markets.find((m) => m.marketId === id) ?? markets.find((m) => m.marketId === visitorMarketId) ?? markets[0];
}

export function WebsiteShellHeader({ consumerUser, ...props }: ShellProps & { consumerUser: ConsumerUser | null }) {
  const market = useShellMarket(props);
  return (
    <WebsiteHeader
      marketId={market.marketId}
      marketName={market.marketName}
      currentCityName={market.currentCityName}
      cities={market.cities}
      consumerUser={consumerUser}
      featuredGuidesHref={market.featuredGuidesHref}
      newsletterHref={market.newsletterHref}
    />
  );
}

export function WebsiteShellFooter(props: ShellProps) {
  const market = useShellMarket(props);
  return <WebsiteFooter featuredGuidesHref={market.featuredGuidesHref} marketId={market.marketId} />;
}
