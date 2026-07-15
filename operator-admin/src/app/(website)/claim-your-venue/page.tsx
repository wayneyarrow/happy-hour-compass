import type { Metadata } from "next";
import Link from "next/link";
import { ClaimJourneySteps } from "./ClaimJourneySteps";
import { AddVenueFallback } from "./AddVenueFallback";
import { JOURNEY_STEPS } from "./content";

/**
 * Public "Claim Your Venue" guided onboarding page (Business Funnel —
 * footer follow-up task). This page still doesn't implement the claim
 * workflow itself — that lives on each venue's own detail page
 * (ClaimVenueCTA / ClaimVenueModalContent) and is unchanged. This page's
 * job is the journey leading up to it: explain what to expect, then send
 * the visitor to the existing public venue search to find their listing.
 *
 * V1 launch scope deliberately excludes an embedded venue finder — that's
 * deferred to a future V2. Here, "Find My Venue" hands off to the existing
 * /website-happy-hours search instead of duplicating search on this page.
 *
 * Must work standalone: as a nav destination, an email-campaign landing
 * page, a Google search result, or a direct link — assume the visitor has
 * never used Happy Hour Compass before. Design language matches
 * /business (the reference implementation for business-facing pages).
 *
 * A plain server component: the only interactive piece, the secondary
 * Add Your Venue fallback, is its own client component — same split as
 * /business.
 */

export const metadata: Metadata = {
  title: "Claim Your Venue",
  description:
    "Own or manage a venue listed on Happy Hour Compass? Here's exactly what to expect when you claim your listing.",
};

export default function ClaimYourVenuePage() {
  return (
    <div>
      {/* ── 1. Hero ───────────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 lg:px-10 pt-16 md:pt-24 pb-14 md:pb-20 text-center">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-4">
          For Businesses
        </p>
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 tracking-tight">
          Claim Your Venue
        </h1>
        <p className="mt-5 text-lg text-gray-500 leading-relaxed max-w-xl mx-auto">
          It only takes a few minutes to claim your venue. Before you begin,
          here&rsquo;s exactly what to expect.
        </p>
      </section>

      {/* ── 2. Guided journey ────────────────────────────────────────────── */}
      <section className="bg-gray-50">
        <div className="max-w-4xl mx-auto px-6 lg:px-10 py-16 md:py-24">
          <ClaimJourneySteps steps={JOURNEY_STEPS} />
        </div>
      </section>

      {/* ── 3. Ready to begin — hand off to the existing venue search ──────── */}
      <section className="max-w-2xl mx-auto px-6 lg:px-10 py-16 md:py-24 text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
          Ready to begin?
        </h2>
        <p className="mt-3 text-base md:text-lg text-gray-500 leading-relaxed">
          Use our venue search to find your restaurant or bar, then open your
          venue listing.
        </p>
        <div className="mt-8">
          <Link
            href="/website-happy-hours"
            className="inline-flex items-center justify-center px-8 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
          >
            Find My Venue
          </Link>
        </div>

        {/* Secondary path — venue not listed yet (V2 will replace this with
            the empty state of an embedded search; for V1 it's the only
            "can't find it" path on this page). */}
        <AddVenueFallback />
      </section>
    </div>
  );
}
