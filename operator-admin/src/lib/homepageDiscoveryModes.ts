/**
 * Homepage Hero — Discovery Mode configuration.
 *
 * The Hero's Happy Hours / Daily Specials / Events selector, CTA, and
 * search pill are all driven off one mode value rather than scattered
 * ternaries — see HeroSection.tsx and HeroDiscoverySearch.tsx. Each mode's
 * `destination` is an existing route (never invented here);
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

export type DiscoveryMode = "happy_hours" | "daily_specials" | "events";

export const DISCOVERY_MODE_ORDER: DiscoveryMode[] = ["happy_hours", "daily_specials", "events"];

export const DEFAULT_DISCOVERY_MODE: DiscoveryMode = "happy_hours";

export type DiscoveryModeConfig = {
  /** Selector label. */
  label: string;
  /** Orange CTA copy (the trailing "→" is rendered separately as an icon). */
  ctaLabel: string;
  /** Existing route the CTA links to, and the base path search results append `?q=` to when `supportsQuerySearch`. */
  destination: string;
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
    searchPlaceholder: "Search venues, food and drink offers...",
    searchAriaLabel: "Search happy hours",
    supportsQuerySearch: true,
    discoveryActionLabel: "happy hours",
  },
  daily_specials: {
    label: "Daily Specials",
    ctaLabel: "Browse Daily Specials",
    destination: "/website-daily-specials",
    searchPlaceholder: "Search wings, tacos, wine...",
    searchAriaLabel: "Search daily specials",
    supportsQuerySearch: true,
    discoveryActionLabel: "daily specials",
  },
  events: {
    label: "Events",
    ctaLabel: "Browse Events",
    destination: "/website-events",
    searchPlaceholder: "Search trivia, live music, events...",
    searchAriaLabel: "Search events",
    supportsQuerySearch: true,
    discoveryActionLabel: "events",
  },
};

export function isDiscoveryMode(value: string): value is DiscoveryMode {
  return (DISCOVERY_MODE_ORDER as string[]).includes(value);
}
