import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getNewsletterMarket } from "@/lib/weeklyPicks/newsletterMarkets";
import { giveawayCalloutNowMs, isGiveawayCalloutVisible } from "@/lib/weeklyPicks/giveaway";
import { NewsletterSignupPageContent } from "./NewsletterSignupPageContent";

/**
 * Public Weekly Picks landing page — Central Okanagan's newsletter and the
 * permanent destination for its campaign links (other markets use
 * /{market}/newsletter). Shared page body: NewsletterSignupPageContent.
 * Signup is Brevo-managed double opt-in; see src/lib/weeklyPicks/signup.ts.
 */

/**
 * Rendered per request so the time-boxed giveaway callout appears and
 * disappears exactly on schedule. Without this the page is prerendered at
 * build time (and served from the CDN), freezing whatever the callout state
 * was when the deployment was built.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = buildPageMetadata({
  title: "Your Happy Hour Plans newsletter",
  description:
    "Your Happy Hour Plans is a free weekly Thursday email with local happy hours, food finds, daily specials and events across Kelowna, West Kelowna and Lake Country.",
  path: "/weekly-picks",
});

const NEWSLETTER = getNewsletterMarket("central-okanagan")!;

export default function WeeklyPicksPage() {
  const showGiveaway = isGiveawayCalloutVisible(giveawayCalloutNowMs());
  return <NewsletterSignupPageContent newsletter={NEWSLETTER} showGiveaway={showGiveaway} />;
}
