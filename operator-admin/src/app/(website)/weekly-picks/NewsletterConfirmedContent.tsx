import Link from "next/link";
import type { NewsletterMarket } from "@/lib/weeklyPicks/newsletterMarkets";
import { getDiscoveryDestination } from "@/lib/homepageDiscoveryModes";

/**
 * The body of a market's "you're confirmed" page — where Brevo's double
 * opt-in link returns the subscriber (NewsletterMarket.confirmedPath). The
 * market comes from the URL path, so it's right even when the link is
 * opened in another browser with no market cookie.
 *
 * Evergreen copy, no dates. Visiting the page is not proof of a
 * subscription (anyone can open the URL), so it fires no analytics event of
 * its own — Brevo's list is the record of confirmed subscribers.
 */
export function NewsletterConfirmedContent({ newsletter }: { newsletter: NewsletterMarket }) {
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
          {newsletter.confirmedText}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href={getDiscoveryDestination("happy_hours", newsletter.marketId)}
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
