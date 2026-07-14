import type { Metadata } from "next";
import Link from "next/link";
import { ClaimVenuePageActions } from "./ClaimVenuePageActions";
import { NumberedStepList } from "@/app/(website)/NumberedStepList";

/**
 * Public "Claim Your Venue" instructional landing page (Business Funnel —
 * footer follow-up task). This page does not implement a claim workflow —
 * the real, venue-specific claim flow already exists (ClaimVenueCTA /
 * ClaimVenueModalContent on each venue's own detail page); this page only
 * explains how to reach it. The footer's "Claim Your Venue" link points
 * here instead of straight into search, giving a business owner context
 * before they land on a results page.
 */

export const metadata: Metadata = {
  title: "Claim Your Venue",
  description:
    "Own or manage a venue listed on Happy Hour Compass? Learn how to claim your listing in three simple steps.",
};

const STEPS = [
  {
    number: 1,
    title: "Search for your venue",
    description: "Use Happy Hour search to find your restaurant or bar.",
  },
  {
    number: 2,
    title: "Open its listing",
    description: "Select your venue to open its Happy Hour Compass page.",
  },
  {
    number: 3,
    title: "Claim and verify",
    description: "Select “Claim this venue” and submit the quick verification form.",
  },
] as const;

export default function ClaimYourVenuePage() {
  return (
    <div className="max-w-3xl mx-auto px-6 lg:px-10 py-16 md:py-24 text-center">
      <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-4">
        For Businesses
      </p>
      <h1 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
        Claim Your Venue
      </h1>
      <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed max-w-xl mx-auto">
        Claiming your listing puts you in control of it — accurate happy hour
        times, specials, and details, so the people searching for exactly
        what you offer can actually find you.
      </p>

      {/* Steps */}
      <div className="mt-14">
        <NumberedStepList steps={STEPS} headingLevel="h2" />
      </div>

      {/* Primary CTA */}
      <div className="mt-14">
        <Link
          href="/website-happy-hours"
          className="inline-flex items-center justify-center px-8 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
        >
          Find My Venue
        </Link>
      </div>

      {/* Secondary path — venue not listed yet */}
      <ClaimVenuePageActions />
    </div>
  );
}
