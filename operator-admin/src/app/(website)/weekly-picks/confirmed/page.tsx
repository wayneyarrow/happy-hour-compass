import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo/metadata";

/**
 * Where Brevo sends people after they click the Weekly Picks confirmation
 * link (the DOI redirectionUrl — src/lib/weeklyPicks/signup.ts).
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

  return (
    <section className="bg-amber-50/60">
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 md:py-24 text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="w-7 h-7" fill="none" stroke="#16a34a" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="mt-6 text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
          Thanks for confirming
        </h1>
        <p className="mt-4 text-base md:text-lg text-gray-600 leading-relaxed">
          Look out for Your Happy Hour Plans in your inbox every Thursday.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/website-happy-hours"
            className="inline-flex justify-center items-center px-6 py-3 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors"
          >
            Browse happy hours
          </Link>
          <Link
            href="/"
            className="inline-flex justify-center items-center px-6 py-3 rounded-full border border-gray-200 text-gray-800 text-sm font-semibold hover:bg-white transition-colors"
          >
            Back to home
          </Link>
        </div>
      </div>
    </section>
  );
}
