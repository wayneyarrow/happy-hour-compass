import { WEEKLY_PICKS_EYEBROW, WEEKLY_PICKS_HEADLINE, WEEKLY_PICKS_PROMISE } from "./weeklyPicks";

/**
 * Per-market "Your Happy Hour Plans" newsletter configuration — the single
 * source for which markets have a newsletter, where its signup and
 * confirmation pages live, and the market's copy. Client-safe: copy and
 * paths only. Whether a market's signup is switched on in this deployment,
 * and its Brevo list/template IDs, are resolved server-side only
 * (newsletterAvailability.ts, getNewsletterBrevoConfig() in
 * src/lib/brevo/config.ts) — never from the browser.
 *
 * Each market is its own Brevo audience. A market missing here, switched
 * off, or misconfigured offers no signup and can never fall back to another
 * market's audience.
 *
 * Adding a market: add an entry here, its env var names in
 * NEWSLETTER_BREVO_ENV (src/lib/brevo/config.ts), and its
 * /{market}/newsletter pages are served by (website)/[market]/newsletter/.
 */

export type NewsletterMarket = {
  marketId: string;
  /** Public signup page. */
  signupPath: string;
  /** Where Brevo's double opt-in link returns the subscriber (path carries the market — no cookie needed). */
  confirmedPath: string;
  eyebrow: string;
  headline: string;
  promise: string;
  /** Signup page <meta name="description">. */
  pageDescription: string;
  /** Signup page "what you'll get" list. */
  includedHeading: string;
  included: readonly string[];
  /** Accepted-state body text, before the "contact us" link. */
  acceptedText: string;
  /** Confirmation page body text. */
  confirmedText: string;
  /** Market-only giveaway on the signup page (see giveaway.ts). */
  hasGiveaway: boolean;
};

const CENTRAL_OKANAGAN: NewsletterMarket = {
  marketId: "central-okanagan",
  signupPath: "/weekly-picks",
  confirmedPath: "/weekly-picks/confirmed",
  eyebrow: WEEKLY_PICKS_EYEBROW,
  headline: WEEKLY_PICKS_HEADLINE,
  promise: WEEKLY_PICKS_PROMISE,
  pageDescription:
    "Your Happy Hour Plans is a free weekly Thursday email with local happy hours, food finds, daily specials and events across Kelowna, West Kelowna and Lake Country.",
  includedHeading: "What you’ll get every Thursday",
  included: [
    "Happy hours worth planning around",
    "Food finds and daily specials",
    "Events happening this week",
    "Occasional local venue spotlights",
  ],
  acceptedText:
    "Check your inbox for a confirmation link. If you already receive Your Happy Hour Plans, you’re all set. If you need help,",
  confirmedText: "Look out for Your Happy Hour Plans in your inbox every Thursday.",
  hasGiveaway: true,
};

/**
 * Greater San Diego collects signups ahead of its first edition, so its
 * copy promises no send day, date or cadence.
 */
const GREATER_SAN_DIEGO: NewsletterMarket = {
  marketId: "greater-san-diego",
  signupPath: "/greater-san-diego/newsletter",
  confirmedPath: "/greater-san-diego/newsletter/confirmed",
  eyebrow: "Free newsletter",
  headline: WEEKLY_PICKS_HEADLINE,
  promise:
    "Local happy hours, food finds, daily specials and events across Greater San Diego, in your inbox. Sign up now to get the first edition. Free.",
  pageDescription:
    "Your Happy Hour Plans is a free email with local happy hours, food finds, daily specials and events across Greater San Diego. Sign up to get the first edition.",
  includedHeading: "What you’ll get",
  included: [
    "Happy hours worth planning around",
    "Food finds and daily specials",
    "Events coming up around town",
    "Occasional local venue spotlights",
  ],
  acceptedText:
    "Check your inbox for a confirmation link to finish signing up for Your Happy Hour Plans in Greater San Diego. If you need help,",
  confirmedText:
    "You’re on the list for Your Happy Hour Plans in Greater San Diego. Look out for the first edition in your inbox.",
  hasGiveaway: false,
};

export const NEWSLETTER_MARKETS: readonly NewsletterMarket[] = [CENTRAL_OKANAGAN, GREATER_SAN_DIEGO];

/** The newsletter for `marketId`, or null when the market has none. */
export function getNewsletterMarket(marketId: unknown): NewsletterMarket | null {
  if (typeof marketId !== "string") return null;
  return NEWSLETTER_MARKETS.find((m) => m.marketId === marketId) ?? null;
}
