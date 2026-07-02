/**
 * Shared constants + recommendation logic for Content Engine guide
 * distribution (Card 6B). Safe to import from both server code and client
 * components (GuideForm) — no DB access here. Server-side reads/writes live
 * in contentGuideDistribution.ts, mirroring the existing
 * discoverOverridesShared.ts / discoverOverrides.ts split.
 *
 * V1 ships exactly two channels. Adding a new one (e.g. "city_homepage")
 * later is a matter of adding a key here and a case in
 * getChannelRecommendations() — no migration required, since
 * content_guide_channels.channel_key is unconstrained TEXT (see migration
 * 055's header comment).
 */

export const DISTRIBUTION_CHANNELS = ["guides_library", "market_homepage"] as const;

export type DistributionChannelKey = (typeof DISTRIBUTION_CHANNELS)[number];

export function isDistributionChannelKey(value: string): value is DistributionChannelKey {
  return (DISTRIBUTION_CHANNELS as readonly string[]).includes(value);
}

/** Human-readable label for a channel — market_homepage needs the guide's own market name. */
export function getChannelDisplayLabel(channelKey: DistributionChannelKey, marketName: string): string {
  switch (channelKey) {
    case "guides_library":
      return "Guides Library";
    case "market_homepage":
      return marketName ? `${marketName} Homepage` : "Market Homepage";
  }
}

// ── Recommendations ──────────────────────────────────────────────────────────
// Informational only — editors always make the final call (see GuideForm's
// Distribution section). Derived entirely from guide metadata already on
// hand; no AI, no network call.

export type ChannelRecommendation = {
  channelKey: DistributionChannelKey;
  label: string;
  recommended: boolean;
  /** Short reason shown next to the checkbox, e.g. "Recommended (Guide Market)". Null when not recommended. */
  reason: string | null;
};

export type RecommendationInputs = {
  marketName: string;
};

export function getChannelRecommendations(inputs: RecommendationInputs): ChannelRecommendation[] {
  const { marketName } = inputs;

  return [
    {
      channelKey: "guides_library",
      label: getChannelDisplayLabel("guides_library", marketName),
      // Every published guide is a reasonable library candidate — no
      // metadata condition needed to recommend this one.
      recommended: true,
      reason: "Recommended",
    },
    {
      channelKey: "market_homepage",
      label: getChannelDisplayLabel("market_homepage", marketName),
      recommended: Boolean(marketName),
      reason: marketName ? "Recommended (Guide Market)" : null,
    },
  ];
}
