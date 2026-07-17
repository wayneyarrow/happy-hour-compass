import type { Metadata } from "next";
import Link from "next/link";
import { ClaimJourneySteps } from "./ClaimJourneySteps";
import { AddVenueFallback } from "./AddVenueFallback";
import { JOURNEY_STEPS } from "./content";
import { buildBreadcrumbListNode } from "@/lib/seo/schema/breadcrumb";
import { JsonLd } from "@/app/(website)/JsonLd";

/**
 * Public "Claim Your Venue" guided onboarding page (Business Funnel —
 * footer follow-up task). This page still doesn't implement the claim
 * workflow itself — that lives on each venue's own detail page
 * (ClaimVenueCTA / ClaimVenueModalContent) and is unchanged. This page's
 * job is a four-step visual walkthrough (find, open, claim, verify), each
 * step backed by a real production screenshot rather than a recreated or
 * mocked-up UI — the screenshots carry most of the instructional weight,
 * per the Guided Claim Venue Screenshots task.
 *
 * No embedded venue finder — "Find My Venue" hands off to the public
 * homepage (/), where the Hero's own venue search already lives.
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
  const breadcrumbNode = buildBreadcrumbListNode({
    canonicalPath: "/claim-your-venue",
    items: [
      { name: "Home", path: "/" },
      { name: "Claim Your Venue", path: "/claim-your-venue" },
    ],
  });

  return (
    <>
      <JsonLd nodes={[breadcrumbNode]} />
      <div>
      {/* ── 1. Hero ───────────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 lg:px-10 pt-16 md:pt-24 pb-8 md:pb-12 text-center">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-4">
          For Businesses
        </p>
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 tracking-tight">
          Claim Your Venue
        </h1>
        <p className="mt-5 text-lg text-gray-500 leading-relaxed max-w-xl mx-auto">
          It only takes a few minutes to claim your venue. Follow the four
          simple steps below to get started.
        </p>
      </section>

      {/* ── 2. Four-step visual walkthrough ─────────────────────────────── */}
      <section className="bg-gray-50">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10 md:py-14">
          <ClaimJourneySteps steps={JOURNEY_STEPS} />
        </div>
      </section>

      {/* ── 3. Bottom CTA — hand off to the homepage search ─────────────── */}
      <section className="max-w-2xl mx-auto px-6 lg:px-10 py-16 md:py-24 text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
          Ready to claim your venue?
        </h2>
        <div className="mt-8">
          <Link
            href="/"
            className="inline-flex items-center justify-center px-8 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
          >
            Find My Venue
          </Link>
        </div>

        {/* Secondary path — venue not listed yet */}
        <AddVenueFallback />
      </section>
      </div>
    </>
  );
}
