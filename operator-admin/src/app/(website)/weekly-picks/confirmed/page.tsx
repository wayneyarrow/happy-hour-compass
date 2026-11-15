import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { getNewsletterMarket } from "@/lib/weeklyPicks/newsletterMarkets";
import { NewsletterConfirmedContent } from "../NewsletterConfirmedContent";

/**
 * Where Brevo sends people after they click the Central Okanagan Weekly
 * Picks confirmation link (the DOI redirectionUrl —
 * src/lib/weeklyPicks/signup.ts; other markets: /{market}/newsletter/confirmed).
 *
 * Evergreen copy, no dates. Visiting this page is not proof of a
 * subscription (anyone can open the URL), so it fires no analytics event of
 * its own — Brevo's list is the record of confirmed subscribers.
 *
 * Any query string is stripped with a server-side redirect before the page
 * (and therefore GA4/Vercel Analytics) renders, so nothing Brevo might
 * append to the redirect URL can reach analytics or page logs.
 */

export const metadata: Metadata = {
  ...buildPageMetadata({
    title: "You're confirmed",
    description: "Thanks for confirming your subscription to Your Happy Hour Plans, the Happy Hour Compass newsletter.",
    path: "/weekly-picks/confirmed",
  }),
  robots: { index: false, follow: true },
};

export default async function WeeklyPicksConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (Object.keys(params).length > 0) {
    redirect("/weekly-picks/confirmed");
  }

  return <NewsletterConfirmedContent newsletter={getNewsletterMarket("central-okanagan")!} />;
}
