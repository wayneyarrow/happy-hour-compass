import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { JourneyTimeline } from "@/app/(website)/JourneyTimeline";
import { ProductTour } from "@/app/(website)/ProductTour";
import { FaqAccordion } from "@/app/(website)/FaqAccordion";
import { BusinessListVenueButton } from "./BusinessListVenueButton";
import { BusinessPricingTable } from "./BusinessPricingTable";
import { HowItWorksPanels } from "./HowItWorksPanels";
import {
  HERO_REASSURANCE,
  HOW_IT_WORKS_INTRO,
  HOW_IT_WORKS_PANELS,
  PILLARS,
  JOURNEY_MILESTONES,
  TOUR_SLIDES,
  BUSINESS_FAQS,
} from "./content";

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
            full-width stacked treatment instead. The 5:3 column ratio (vs.
            an even split) and the lg:text-3xl step-down give the headline
            enough room at lg: for each of its three forced lines to fit on
            one line — verified empirically down to the 1024px lg: edge,
            not just by eye at typical desktop widths. */}
        <div className="grid lg:grid-cols-[5fr_3fr] gap-12 items-center">
          <div className="text-center lg:text-left">
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-5">
              For Businesses
            </p>
            {/* The <br> pair only renders (as a break) at lg: and up — that's
                what pins the three approved line breaks on desktop while
                leaving mobile/tablet to wrap the same continuous sentence
                naturally at whatever width they have. */}
            <h1 className="text-4xl sm:text-5xl lg:text-3xl font-bold text-gray-900 tracking-tight leading-[1.15]">
              Put your happy hour and events{" "}
              <br className="hidden lg:block" />
              in front of people already looking{" "}
              <br className="hidden lg:block" />
              for somewhere to go.
            </h1>
            <p className="mt-6 text-lg text-gray-500 leading-relaxed max-w-lg mx-auto lg:mx-0">
              Bring more guests through your doors. We help people discover your happy
              hours and events — starting with a free venue listing.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <BusinessListVenueButton className={PRIMARY_CTA_CLASS}>
                List Your Venue Free
              </BusinessListVenueButton>
              <Link href="#how-it-works" className={SECONDARY_CTA_CLASS}>
                See How It Works
              </Link>
            </div>
            <ul
              role="list"
              className="mt-6 flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 list-none p-0"
            >
              {HERO_REASSURANCE.map((item) => (
                <li key={item} className="flex items-center gap-1.5 text-xs sm:text-sm text-gray-500">
                  <ReassuranceCheckIcon />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative aspect-[1/1] w-full rounded-2xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.10),0_4px_16px_rgba(0,0,0,0.06)]">
            <Image
              src="/images/business/hero-busy-patio.jpg"
              alt="A lively restaurant patio full of guests enjoying happy hour together over drinks and shared plates"
              fill
              priority
              sizes="(min-width: 1024px) 400px, (min-width: 768px) 700px, 100vw"
              className="object-cover object-[50%_40%]"
            />
          </div>
        </div>
      </section>

      {/* ── 2. Getting Started is Easy ───────────────────────────────────── */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
          Getting Started is <span className="text-amber-500">Easy</span>
        </h2>
        <p className="mt-5 max-w-2xl mx-auto text-base md:text-lg text-gray-500 leading-relaxed">
          {HOW_IT_WORKS_INTRO}
        </p>
        <div className="mt-14">
          <HowItWorksPanels panels={HOW_IT_WORKS_PANELS} />
        </div>
      </section>

      {/* ── 3. Why Happy Hour Compass Exists ────────────────────────────── */}
      {/* This is the page's mission statement, not a feature section — an
          editorial image + copy layout (photo anchors the story, prose reads
          left-to-right) rather than another centered text block, per the
          Business Funnel Blueprint's Section 3 rethink. Text is left-aligned
          at every breakpoint (unlike most sections' text-center) because
          multi-paragraph editorial prose reads better that way than
          centered — a deliberate departure, not an oversight. */}
      <section className="bg-gray-50">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* w-[88%] (not max-w) scales the photo down ~12% within its
                existing column so it supports the story rather than
                dominating it — the grid, gap, and the image's own aspect
                ratio are untouched. Must be an explicit width, not max-w:
                mx-auto plus an auto width on a grid item disables the
                column's default stretch sizing and collapses the box to
                zero — the same pitfall hit and fixed on the hero image. */}
            <div className="w-[88%] mx-auto">
              <div className="relative aspect-[4/5] w-full rounded-2xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.10),0_4px_16px_rgba(0,0,0,0.06)]">
                <Image
                  src="/images/business/business-why-hhc-exists-happy-hour-friends.jpg"
                  alt="Friends clinking cocktail glasses together over a table of shared plates during happy hour"
                  fill
                  sizes="(min-width: 1024px) 445px, (min-width: 768px) 620px, 88vw"
                  className="object-cover object-center"
                />
              </div>
            </div>
            <div className="text-left">
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-4">
                Our Mission
              </p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
                Why Happy Hour Compass Exists
              </h2>
              <p className="mt-6 text-xl md:text-2xl font-semibold text-gray-900 leading-snug">
                Finding a restaurant is easy. Finding a great happy hour? Not so much.
              </p>
              <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
                Right now, people jump between Google, social media, restaurant websites, and
                outdated blog posts, all trying to answer one simple question:{" "}
                <em className="text-gray-700">
                  &ldquo;Where can I find a great happy hour tonight?&rdquo;
                </em>
              </p>
              <p className="mt-6 text-base md:text-lg text-gray-500 leading-relaxed">
                There wasn&apos;t a single place dedicated to helping people discover happy
                hours, events, patios, and local experiences.
              </p>
              <p className="mt-4 text-base md:text-lg font-semibold text-gray-900">
                So we built one.
              </p>

              <div className="mt-8 pl-5 border-l-4 border-amber-400">
                <p className="text-lg md:text-xl font-semibold text-gray-900 leading-snug">
                  We&apos;re not selling restaurant software. We&apos;re not trying to
                  convince venues to create more offers. We&apos;re helping more people
                  discover the ones that already exist.
                </p>
              </div>

              <p className="mt-8 text-lg md:text-xl font-bold text-gray-900 tracking-tight leading-snug">
                <span className="block">More discovery. More guests.</span>
                <span className="block">More bums on seats.</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. Why Choose Happy Hour Compass ──────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            Why Choose Happy Hour Compass
          </h2>
        </div>
        <div className="mt-14 grid sm:grid-cols-3 gap-6">
          {PILLARS.map((pillar) => (
            <div
              key={pillar.id}
              className="rounded-2xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.05)] p-8 md:p-10 text-center"
            >
              <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-50 ring-1 ring-amber-200/70 text-amber-700 items-center justify-center mb-6">
                {pillar.icon}
              </div>
              <h3 className="text-xl font-bold text-gray-900">{pillar.title}</h3>
              <p className="mt-3 text-base text-gray-600 leading-relaxed">
                {pillar.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 5. More Guests Starts Here ───────────────────────────────────  */}
      <div className="bg-gray-50">
        <JourneyTimeline
          heading="More Guests Starts Here"
          intro="From creating your listing to your next new customer, we'll help every step of the way."
          bridge="Four simple steps. One important result: more guests through your door."
          milestones={JOURNEY_MILESTONES}
        />
      </div>

      {/* ── 6. See Happy Hour Compass in Action ──────────────────────────  */}
      <section className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            See How It Works
          </h2>
          <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
            Keeping your listing fresh is easier than updating your social media.
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
        <FaqAccordion
          items={BUSINESS_FAQS}
          heading="Still have questions?"
          description="Here are answers to the ones we hear most often from restaurant and bar owners."
        />
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

function ReassuranceCheckIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0 text-gray-400"
      fill="currentColor"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}
