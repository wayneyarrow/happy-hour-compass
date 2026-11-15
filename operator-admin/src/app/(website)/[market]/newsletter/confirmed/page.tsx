import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getNewsletterMarket } from "@/lib/weeklyPicks/newsletterMarkets";
import { NewsletterConfirmedContent } from "../../../weekly-picks/NewsletterConfirmedContent";

/**
 * Where Brevo's double opt-in link returns a market's new subscriber —
 * /{market}/newsletter/confirmed (NewsletterMarket.confirmedPath, the DOI
 * redirectionUrl — src/lib/weeklyPicks/signup.ts). The market is in the
 * path, so the right market shows even when the link is opened in another
 * browser with no market cookie.
 *
 * A market confirmed elsewhere (Central Okanagan: /weekly-picks/confirmed)
 * redirects there; a market with no newsletter → 404. Unlike the signup
 * page it does NOT depend on the market's signup switch: Brevo has already
 * confirmed the subscriber before redirecting here, so a link sent just
 * before signup was switched off must still land on this page. Any query string is stripped with a
 * server-side redirect before the page (and therefore analytics) renders,
 * exactly as /weekly-picks/confirmed does. Not indexed.
 */

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ market: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { market } = await params;
  const newsletter = getNewsletterMarket(market);
  if (!newsletter || newsletter.confirmedPath !== `/${market}/newsletter/confirmed`) return {};
  return {
    ...buildPageMetadata({
      title: "You're confirmed",
      description: "Thanks for confirming your subscription to Your Happy Hour Plans, the Happy Hour Compass newsletter.",
      path: newsletter.confirmedPath,
    }),
    robots: { index: false, follow: true },
  };
}

export default async function MarketNewsletterConfirmedPage({ params, searchParams }: PageProps) {
  const { market } = await params;
  const newsletter = getNewsletterMarket(market);
  if (!newsletter) notFound();
  if (newsletter.confirmedPath !== `/${market}/newsletter/confirmed`) permanentRedirect(newsletter.confirmedPath);

  if (Object.keys(await searchParams).length > 0) redirect(newsletter.confirmedPath);

  return <NewsletterConfirmedContent newsletter={newsletter} />;
}
