import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getNewsletterMarket } from "@/lib/weeklyPicks/newsletterMarkets";
import { getAvailableNewsletterMarket } from "@/lib/weeklyPicks/newsletterAvailability";
import { giveawayCalloutNowMs, isGiveawayCalloutVisible } from "@/lib/weeklyPicks/giveaway";
import { NewsletterSignupPageContent } from "../../weekly-picks/NewsletterSignupPageContent";

/**
 * A market's "Your Happy Hour Plans" signup page — /{market}/newsletter.
 * The market comes from the path, so direct visits work with no cookie.
 *
 *   - A market whose signup page lives elsewhere (Central Okanagan:
 *     /weekly-picks, its permanent campaign URL) redirects there.
 *   - A market with no newsletter, or whose signup is switched off in this
 *     deployment (getAvailableNewsletterMarket), is a 404 — the page only
 *     exists where signup works.
 *
 * Rendered per request: availability is an environment switch, and a
 * market with a giveaway follows its schedule.
 */

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ market: string }> };

function resolve(market: string) {
  const known = getNewsletterMarket(market);
  if (!known) notFound();
  if (known.signupPath !== `/${market}/newsletter`) permanentRedirect(known.signupPath);
  const available = getAvailableNewsletterMarket(market);
  if (!available) notFound();
  return available;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { market } = await params;
  const newsletter = getAvailableNewsletterMarket(market);
  if (!newsletter || newsletter.signupPath !== `/${market}/newsletter`) return {};
  return buildPageMetadata({
    title: "Your Happy Hour Plans newsletter",
    description: newsletter.pageDescription,
    path: newsletter.signupPath,
  });
}

export default async function MarketNewsletterPage({ params }: PageProps) {
  const { market } = await params;
  const newsletter = resolve(market);
  const showGiveaway = newsletter.hasGiveaway && isGiveawayCalloutVisible(giveawayCalloutNowMs());
  return <NewsletterSignupPageContent newsletter={newsletter} showGiveaway={showGiveaway} />;
}
