import type { Metadata } from "next";
import Link from "next/link";
import { NumberedStepList } from "@/app/(website)/NumberedStepList";
import { JourneyTimeline } from "@/app/(website)/JourneyTimeline";
import { ProductTour } from "@/app/(website)/ProductTour";
import { FaqAccordion } from "@/app/(website)/FaqAccordion";
import { BrowserMockFrame } from "@/app/(website)/BrowserMockFrame";
import { BusinessListVenueButton } from "./BusinessListVenueButton";
import { BusinessPricingTable } from "./BusinessPricingTable";
import { HOW_IT_WORKS_STEPS, PILLARS, JOURNEY_MILESTONES, TOUR_SLIDES, BUSINESS_FAQS } from "./content";

/**
 * Public "For Businesses" page — the primary sales page for the business
 * side of Happy Hour Compass, and the reference implementation for the
 * design language of every future business-facing page (Claim Your Venue,
 * Pricing, About, Careers). Implements
 * docs/product/BUSINESS_FUNNEL_PRODUCT_BLUEPRINT.md section by section —
 * check that document before changing structure, copy, or CTA wiring.
 *
 * A plain server component: every interactive piece (product tour tabs,
 * FAQ accordion, "List Your Venue Free" CTA) is its own client component,
 * imported here rather than making the whole page a client bundle — same
 * pattern as claim-your-venue/page.tsx.
 */

export const metadata: Metadata = {
  title: "For Businesses",
  description:
    "Put your happy hour and events in front of people already looking for somewhere to go. List your venue on Happy Hour Compass for free.",
};

const PRIMARY_CTA_CLASS =
  "inline-flex items-center justify-center px-8 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2";

const SECONDARY_CTA_CLASS =
  "inline-flex items-center justify-center px-8 py-3.5 border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold rounded-full text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2";

export default function ForBusinessesPage() {
  return (
    <div>
      {/* ── 1. Hero ─────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 lg:px-10 pt-16 md:pt-24 pb-16 md:pb-24">
        {/* Two columns only from lg: up — at tablet widths a narrower text
            column makes this headline wrap awkwardly, so tablet gets the
            full-width stacked treatment instead. */}
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="text-center lg:text-left">
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-4">
              For Businesses
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 tracking-tight leading-[1.1]">
              Put your happy hour and events in front of people already looking for
              somewhere to go.
            </h1>
            <p className="mt-5 text-lg text-gray-500 leading-relaxed max-w-lg mx-auto lg:mx-0">
              Get discovered by nearby guests searching for happy hours and events —
              starting with a free venue listing.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <BusinessListVenueButton className={PRIMARY_CTA_CLASS}>
                List Your Venue Free
              </BusinessListVenueButton>
              <Link href="#how-it-works" className={SECONDARY_CTA_CLASS}>
                See How It Works
              </Link>
            </div>
          </div>
          <div>
            <BrowserMockFrame placeholderLabel="Venue Listing Preview" />
          </div>
        </div>
      </section>

      {/* ── 2. How It Works ─────────────────────────────────────────────── */}
      <section id="how-it-works" className="max-w-4xl mx-auto px-6 lg:px-10 py-16 md:py-24 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
          How It Works
        </h2>
        <div className="mt-14">
          <NumberedStepList steps={HOW_IT_WORKS_STEPS} />
        </div>
      </section>

      {/* ── 3. Why Happy Hour Compass Exists ────────────────────────────── */}
      <section className="bg-gray-50">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 py-16 md:py-24 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            Why Happy Hour Compass Exists
          </h2>
          <p className="mt-6 text-base md:text-lg text-gray-500 leading-relaxed">
            Restaurants invest heavily in attracting dinner crowds, yet some of the most
            profitable hours of the day are often the hardest to fill. Happy Hour Compass
            exists to connect people looking for somewhere to go right now with venues
            already offering great happy hours, events, patios, and local experiences.
          </p>
          <p className="mt-6 text-base md:text-lg font-semibold text-gray-900 leading-relaxed">
            We&apos;re not asking venues to invent discounts. We&apos;re helping people
            discover the ones they already offer.
          </p>
        </div>
      </section>

      {/* ── 4. Why Venues Choose Happy Hour Compass ─────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            Why Venues Choose Happy Hour Compass
          </h2>
        </div>
        <div className="mt-14 grid sm:grid-cols-3 gap-10">
          {PILLARS.map((pillar) => (
            <div key={pillar.id} className="text-center sm:text-left">
              <div className="inline-flex w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 items-center justify-center mb-5">
                {pillar.icon}
              </div>
              <h3 className="text-lg font-semibold text-gray-900">{pillar.title}</h3>
              <p className="mt-2 text-base text-gray-700 font-medium leading-snug">
                {pillar.headline}
              </p>
              <ul className="mt-3 space-y-1.5">
                {pillar.points.map((point) => (
                  <li key={point} className="text-sm text-gray-500 leading-relaxed">
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── 5. More Guests Starts Here ───────────────────────────────────  */}
      <div className="bg-gray-50">
        <JourneyTimeline
          heading="More Guests Starts Here"
          intro="Only a few simple milestones separate you from reaching more local customers."
          milestones={JOURNEY_MILESTONES}
        />
      </div>

      {/* ── 6. See Happy Hour Compass in Action ──────────────────────────  */}
      <section className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            See Happy Hour Compass in Action
          </h2>
          <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
            A closer look at what happens after your venue goes live.
          </p>
        </div>
        <div className="mt-12">
          <ProductTour slides={TOUR_SLIDES} />
        </div>
      </section>

      {/* ── 7. Pricing ────────────────────────────────────────────────────*/}
      <div className="bg-gray-50">
        <BusinessPricingTable />
      </div>

      {/* ── 8. FAQ ────────────────────────────────────────────────────────*/}
      <section className="max-w-3xl mx-auto px-6 lg:px-10 py-16 md:py-24">
        <FaqAccordion items={BUSINESS_FAQS} />
      </section>

      {/* ── 9. Final CTA ──────────────────────────────────────────────────*/}
      <section className="bg-gray-900">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 py-16 md:py-24 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            Ready to become someone&apos;s new favourite local spot?
          </h2>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <BusinessListVenueButton className={PRIMARY_CTA_CLASS}>
              List Your Venue Free
            </BusinessListVenueButton>
            <Link
              href="/claim-your-venue"
              className="inline-flex items-center justify-center px-8 py-3.5 border border-gray-700 text-white hover:bg-gray-800 font-semibold rounded-full text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              Claim Your Venue
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
