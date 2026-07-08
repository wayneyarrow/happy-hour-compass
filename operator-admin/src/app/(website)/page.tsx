import type { Metadata } from "next";
import Link from "next/link";
import HeroSection from "./HeroSection";
import { GuideCard } from "./GuideCard";
import { getActiveMarket } from "@/lib/activeMarket";
import { getMarketBySlug, getDefaultCityForMarket } from "@/lib/geo/geography";
import type { Market } from "@/lib/markets";
import {
  getFeaturedGuidesForMarket,
  type PublicGuideCardData,
} from "@/lib/data/contentGuideDistribution";

// Resolves the consumer-facing city name for the hero's search placeholder.
// Mirrors the fallback pattern in layout.tsx's header city lookup — falls
// back to the market config name if the DB geography lookup is unavailable.
async function getHeroCityName(market: Market): Promise<string> {
  try {
    const marketRecord = await getMarketBySlug(market.id);
    if (marketRecord) {
      const defaultCity = await getDefaultCityForMarket(marketRecord.id);
      if (defaultCity) return defaultCity.name;
    }
  } catch {
    // DB unavailable — fall back to market config name.
  }
  return market.name;
}

export const metadata: Metadata = {
  title: { absolute: "Happy Hour Compass — Find the best happy hours near you" },
  description:
    "Discover curated happy hour deals at bars and restaurants near you. Real menus, real prices, real hours — updated by the venues themselves.",
};

function HowItWorksSection() {
  const steps = [
    {
      number: "01",
      title: "Browse by vibe",
      body: "Filter by patio, craft cocktails, wine specials, food deals, and more. Find the scene that matches the night.",
    },
    {
      number: "02",
      title: "Check real menus",
      body: "Every deal you see is managed directly by the venue — actual prices, actual hours, no surprises at the door.",
    },
    {
      number: "03",
      title: "Show up and enjoy",
      body: "No app required at the venue. Just arrive during happy hour and order. It's that simple.",
    },
  ];

  return (
    <section id="discover" className="bg-gray-50 border-t border-gray-100 py-20 md:py-28">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            How it works
          </h2>
          <p className="mt-3 text-base text-gray-500 max-w-sm mx-auto">
            Three steps to your next great happy hour.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {steps.map((step) => (
            <div key={step.number} className="bg-white rounded-2xl p-8 border border-gray-100 shadow-sm">
              <p className="text-4xl font-bold text-amber-400 mb-4">{step.number}</p>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Featured Guides — Card 6B Part 4. Consumes the exact same merchandising
 * data as the /{market}/guides library (getFeaturedGuidesForMarket just
 * caps it), which remains the canonical destination via "View all guides".
 * Renders nothing when the active market has no active homepage placements
 * yet, rather than showing an empty section.
 *
 * TEMPORARILY DISABLED — Card 6B touch-up. This rail was throwing errors on
 * the live homepage; the underlying distribution architecture (migration
 * 055's tables, contentGuideDistribution.ts, the Content Engine editor's
 * Distribution section, and Discover Management's /control-panel/discover/guides
 * merchandising UI) is fully intact and untouched — only this homepage's
 * consumption of it is switched off, via FEATURED_GUIDES_HOMEPAGE_ENABLED
 * below. Proper re-integration (including root-causing the error) is
 * planned for the Homepage & Discover Management V2 initiative.
 */
function FeaturedGuidesSection({
  guides,
  marketSlug,
  marketName,
}: {
  guides: PublicGuideCardData[];
  marketSlug: string;
  marketName: string;
}) {
  if (guides.length === 0) return null;

  return (
    <section className="bg-white py-16 md:py-20 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="flex items-end justify-between mb-8 gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
              Guides to {marketName}
            </h2>
            <p className="mt-1 text-sm text-gray-500">Editorial picks curated by Happy Hour Compass.</p>
          </div>
          <Link
            href={`/${marketSlug}/guides`}
            className="shrink-0 text-sm font-semibold text-amber-600 hover:text-amber-700 transition-colors"
          >
            View all guides →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {guides.map((g) => (
            <GuideCard
              key={g.slug}
              title={g.title}
              href={`/${marketSlug}/guides/${g.slug}`}
              heroImageUrl={g.heroImageUrl}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ForOwnersSection() {
  return (
    <section id="for-owners" className="bg-white py-20 md:py-28 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-4">
              For venue owners
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight leading-snug">
              Your happy hour,
              <br />
              <span className="text-amber-500">your story.</span>
            </h2>
            <p className="mt-5 text-base text-gray-500 leading-relaxed max-w-md">
              Take control of how your venue appears to diners. Update your
              specials in minutes, showcase what makes your happy hour
              worth the trip.
            </p>
            <ul className="mt-8 space-y-3">
              {[
                "Free to list during beta",
                "Real-time menu management",
                "Reach diners already looking for happy hours",
                "No commissions, no fees",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-gray-600">
                  <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414L8.414 15l-4.121-4.121a1 1 0 011.414-1.414L8.414 12.172l7.879-7.879a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-10">
              <Link
                href="/suggest/owner"
                className="inline-flex items-center px-6 py-3 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-full text-sm transition-colors"
              >
                Claim your venue
                <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>
          </div>

          {/* Visual placeholder */}
          <div className="relative hidden lg:block">
            <div className="aspect-[4/3] rounded-3xl bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 border border-amber-100 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl bg-amber-500 mx-auto flex items-center justify-center mb-4 shadow-lg">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-amber-700">Venue dashboard preview</p>
                <p className="text-xs text-amber-500 mt-1">Coming soon</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="bg-amber-500 py-20">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
          Your next favourite spot is waiting.
        </h2>
        <p className="mt-4 text-base text-amber-100 max-w-md mx-auto">
          Start exploring happy hours near you — no account required.
        </p>
        <div className="mt-8">
          <Link
            href="/app"
            className="inline-flex items-center px-8 py-3.5 bg-white hover:bg-amber-50 text-amber-600 font-bold rounded-full text-base shadow-sm transition-colors"
          >
            Explore happy hours
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
// FEATURED_GUIDES_HOMEPAGE_ENABLED — see the TEMPORARILY DISABLED note on
// FeaturedGuidesSection above. Flip back to true (and re-run this page)
// once the V2 initiative re-integrates this rail properly.
const FEATURED_GUIDES_HOMEPAGE_ENABLED = false;

export default async function WebsiteHomePage() {
  const { market, isPersisted } = await getActiveMarket();
  const [featuredGuides, cityName] = await Promise.all([
    FEATURED_GUIDES_HOMEPAGE_ENABLED ? getFeaturedGuidesForMarket(market.id) : Promise.resolve([]),
    getHeroCityName(market),
  ]);

  return (
    <>
      <HeroSection market={market} cityName={cityName} isPersisted={isPersisted} />
      {FEATURED_GUIDES_HOMEPAGE_ENABLED && (
        <FeaturedGuidesSection guides={featuredGuides} marketSlug={market.id} marketName={market.name} />
      )}
      <HowItWorksSection />
      <ForOwnersSection />
      <CtaSection />
    </>
  );
}
