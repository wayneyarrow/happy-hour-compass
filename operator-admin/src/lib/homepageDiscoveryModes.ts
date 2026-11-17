/**
 * Homepage Hero — Discovery Mode configuration.
 *
 * The Hero's Happy Hours / Daily Specials / Events selector, CTA, and
 * search pill are all driven off one mode value rather than scattered
 * ternaries — see HeroSection.tsx and HeroDiscoverySearch.tsx. Each mode
 * links to its market's own listing (getDiscoveryDestination():
 * /{market}/{segment}), falling back to the legacy `destination` route when
 * the market isn't known; 
 * `supportsQuerySearch` reflects whether that destination page actually
 * has a `?q=` free-text search contract today:
 *   - /website-happy-hours (HappyHoursSearchClient.tsx) — yes.
 *   - /website-daily-specials (DailySpecialSearchResults.tsx,
 *     enableFilterSync) — yes.
 *   - /website-events (EventSearchResults.tsx) — yes, as of the
 *     mode-aware search correction: `?q=` is filtered via
 *     eventMatchesSearch() (src/lib/eventSearch.ts), the same matcher the
 *     Hero's Events-mode autocomplete uses (eventSuggestions.ts).
 *
 * Each mode also searches its own entity type, never a stand-in: Happy
 * Hours searches venues, Daily Specials searches Daily Special records,
 * Events searches Event records — see HeroDiscoverySearch.tsx's
 * DiscoveryResult union and suggestActions.ts.
 */

import { getMarketById } from "@/lib/markets";

export type DiscoveryMode = "happy_hours" | "daily_specials" | "events";

export const DISCOVERY_MODE_ORDER: DiscoveryMode[] = ["happy_hours", "daily_specials", "events"];

export const DEFAULT_DISCOVERY_MODE: DiscoveryMode = "happy_hours";

export type DiscoveryModeConfig = {
  /** Selector label. */
  label: string;
  /** Orange CTA copy (the trailing "→" is rendered separately as an icon). */
  ctaLabel: string;
  /**
   * Legacy market-less route (/website-…), which follows the visitor's saved
   * market, else their country. Links that know their market use
   * getDiscoveryDestination() instead, which points at the market's own
   * listing URL (/{market}/{segment}).
   */
  destination: string;
  /** URL segment of this listing under a market: /{market}/{segment}. */
  segment: string;
  /** Hero search input placeholder. */
  searchPlaceholder: string;
  /** aria-label for the search input. */
  searchAriaLabel: string;
  /** Whether `destination` has a `?q=`-aware search results contract — see file header. */
  supportsQuerySearch: boolean;
  /** Lowercase noun phrase used in the search dropdown's "See all {discoveryActionLabel} matching …" action. */
  discoveryActionLabel: string;
};

export const DISCOVERY_MODES: Record<DiscoveryMode, DiscoveryModeConfig> = {
  happy_hours: {
    label: "Happy Hours",
    ctaLabel: "Browse Happy Hours",
    destination: "/website-happy-hours",
    segment: "happy-hours",
    searchPlaceholder: "Search venues, food and drink offers...",
    searchAriaLabel: "Search happy hours",
    supportsQuerySearch: true,
    discoveryActionLabel: "happy hours",
  },
  daily_specials: {
    label: "Daily Specials",
    ctaLabel: "Browse Daily Specials",
    destination: "/website-daily-specials",
    segment: "daily-specials",
    searchPlaceholder: "Search wings, tacos, wine...",
    searchAriaLabel: "Search daily specials",
    supportsQuerySearch: true,
    discoveryActionLabel: "daily specials",
  },
  events: {
    label: "Events",
    ctaLabel: "Browse Events",
    destination: "/website-events",
    segment: "events",
    searchPlaceholder: "Search trivia, live music, events...",
    searchAriaLabel: "Search events",
    supportsQuerySearch: true,
    discoveryActionLabel: "events",
  },
};

export function isDiscoveryMode(value: string): value is DiscoveryMode {
  return (DISCOVERY_MODE_ORDER as string[]).includes(value);
}

/**
 * The listing a link should open for `mode`: the market's own listing URL
 * (/central-okanagan/happy-hours, /greater-san-diego/events, …) when the
 * link knows its market and that market is active, else the legacy
 * market-less route. Market listing URLs always show their own market, so a
 * Browse button or nav link on a Kelowna page opens Kelowna results whatever
 * the visitor's saved market is.
 */
export function getDiscoveryDestination(mode: DiscoveryMode, marketId?: string | null): string {
  const config = DISCOVERY_MODES[mode];
  const market = marketId ? getMarketById(marketId) : undefined;
  return market?.status === "active" ? `/${market.id}/${config.segment}` : config.destination;
}

/** The listing mode of a market listing URL (/{active-market}/{segment}), or null. */
export function getMarketListingModeForPath(pathname: string | null | undefined): DiscoveryMode | null {
  const parts = (pathname ?? "").split("/");
  if (parts.length !== 3 || !parts[1]) return null;
  if (getMarketById(parts[1])?.status !== "active") return null;
  return DISCOVERY_MODE_ORDER.find((mode) => DISCOVERY_MODES[mode].segment === parts[2]) ?? null;
}
