import type { ReactNode } from "react";
import type { HowItWorksPanel } from "./HowItWorksPanels";
import type { JourneyMilestone } from "@/app/(website)/JourneyTimeline";
import type { ProductTourSlide } from "@/app/(website)/ProductTour";
import type { FaqAccordionItem } from "@/app/(website)/FaqAccordion";
import { ProductTourHappyHourVisual } from "./ProductTourHappyHourVisual";
import { ProductTourEventsVisual } from "./ProductTourEventsVisual";
import { ClaimVsAddFaqLinks } from "./ClaimVsAddFaqLinks";

/**
 * Static page copy for /business, kept separate from page.tsx so the
 * section components above stay focused on layout/behavior and this file
 * stays focused on content. Every string here maps directly to a locked
 * or recommended line in docs/product/BUSINESS_FUNNEL_PRODUCT_BLUEPRINT.md
 * — check that document before editing copy.
 */

// ── Section 1: Hero reassurance line ─────────────────────────────────────────

export const HERO_REASSURANCE: readonly string[] = [
  "Free forever",
  "No credit card required",
  "Get started in minutes",
];

// ── Section 2: Getting Started is Easy ───────────────────────────────────────

export const HOW_IT_WORKS_INTRO =
  "Claim or create your venue in minutes, keep it up to date from anywhere, " +
  "and we'll help more guests discover you.";

function HowItWorksIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" className="w-8 h-8">
      {children}
    </svg>
  );
}

export const HOW_IT_WORKS_PANELS: readonly HowItWorksPanel[] = [
  {
    id: "list-your-venue",
    title: "List Your Venue",
    description:
      "Claim an existing venue or create a new listing — you'll be up and running in just a few minutes.",
    icon: (
      <HowItWorksIcon>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 10.5 12 4l8 6.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 9.5V20h13V9.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 20v-6h5v6" />
      </HowItWorksIcon>
    ),
  },
  {
    id: "keep-it-fresh",
    title: "Keep It Fresh",
    description: (
      <>
        Update your happy hours, events, and venue details anytime, from anywhere —{" "}
        <span className="font-semibold text-gray-700">even from your phone</span>.
      </>
    ),
    icon: (
      <HowItWorksIcon>
        <rect x="7" y="2.5" width="10" height="19" rx="2.2" />
        <path strokeLinecap="round" d="M11 18.2h2" />
      </HowItWorksIcon>
    ),
  },
  {
    id: "get-discovered",
    title: "Get Discovered",
    description: "We put your venue in front of guests already looking for somewhere to go.",
    icon: (
      <HowItWorksIcon>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path strokeLinecap="round" d="M20 20l-4.8-4.8" />
      </HowItWorksIcon>
    ),
  },
  {
    id: "welcome-more-guests",
    title: "Get More Guests",
    description: "Welcome new guests today — then turn them into regulars.",
    icon: (
      <HowItWorksIcon>
        <circle cx="9" cy="8" r="3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 19c0-3.6 2.7-6 5.5-6s5.5 2.4 5.5 6" />
        <circle cx="16.5" cy="9" r="2.3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13.2c2.4.3 4.5 2.3 4.5 5.8" />
      </HowItWorksIcon>
    ),
  },
];

// ── Section 4: Why Venues Choose Happy Hour Compass ──────────────────────────

export type Pillar = {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
};

function PillarIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" className="w-9 h-9">
      {children}
    </svg>
  );
}

export const PILLARS: Pillar[] = [
  {
    id: "be-found",
    title: "Be Found When It Matters",
    description:
      "Instead of advertising to everyone, reach people already deciding where to go tonight.",
    icon: (
      // Target — being found precisely when someone's looking, not generic reach.
      <PillarIcon>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4.5" />
        <circle cx="12" cy="12" r="0.75" fill="currentColor" />
      </PillarIcon>
    ),
  },
  {
    id: "stay-current",
    title: "Stay Current",
    description:
      "Keep your happy hours, events, and business information up to date in just a few minutes.",
    icon: (
      // Refresh — updating, not just the passage of time (a plain clock).
      <PillarIcon>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 11a8 8 0 1 0-2.5 6.9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 5v6h-6" />
      </PillarIcon>
    ),
  },
  {
    id: "in-control",
    title: "You're Always in Control",
    description: "Your listing belongs to you. Update it, pause it, or change it whenever you need.",
    icon: (
      <PillarIcon>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      </PillarIcon>
    ),
  },
];

// ── Section 5: More Guests Starts Here (journey) ─────────────────────────────

function MilestoneIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" className="w-5 h-5 text-amber-600">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export const JOURNEY_MILESTONES: JourneyMilestone[] = [
  {
    id: "get-on-hhc",
    title: "List Your Business",
    detail: "Claim or create your business listing.",
    icon: <MilestoneIcon d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />,
  },
  {
    id: "make-it-your-own",
    title: "Make It Your Own",
    detail: "Branding, happy hours, events, and business information.",
    icon: <MilestoneIcon d="M4 20l4-1 10-10-3-3L5 16l-1 4z" />,
  },
  {
    id: "help-people-discover-you",
    title: "We'll Help People Discover You",
    detail: "We put your happy hours and events in front of people already deciding where to go.",
    icon: <MilestoneIcon d="M21 21l-4.35-4.35M18 11a7 7 0 11-14 0 7 7 0 0114 0z" />,
  },
  {
    id: "welcome-more-guests",
    title: "Welcome More Guests",
    detail: "More people finding their way to your door.",
    // Dollar sign — a subtle cue that the journey ends in a business result,
    // not another discovery/product step. Same MilestoneIcon treatment
    // (size, colour, stroke) as every other marker, just a different path.
    icon: <MilestoneIcon d="M12 4v16M16 8.5c-.8-1-2.2-1.7-4-1.7-2.4 0-4 1.3-4 3s1.6 2.6 4 3.2c2.4.6 4 1.3 4 3s-1.6 3-4 3c-1.8 0-3.2-.7-4-1.7" />,
  },
];

// ── Section 6: See How It Works (product tour) ───────────────────────────────

export const TOUR_SLIDES: ProductTourSlide[] = [
  {
    id: "get-started",
    tabLabel: "Get Started",
    headline: "Get Your Business on Happy Hour Compass",
    copy: "Claim your existing listing or add your business in just a few minutes. Once you're approved, you can update your happy hours, events, photos, and business information whenever you like.",
    outcome: "Be online in minutes.",
    image: {
      src: "/images/business/business-page-venue-detail-1.png",
      alt: "Business details form in Operator Admin showing venue name, address, and business information fields",
    },
  },
  {
    id: "update-happy-hours",
    tabLabel: "Update Happy Hours",
    headline: "Keep Your Happy Hours Up to Date",
    copy: "Update your happy hours, food specials, and drink specials whenever things change—no waiting on anyone else to update your listing.",
    outcome: "Keep your customers informed.",
    visual: <ProductTourHappyHourVisual />,
  },
  {
    id: "promote-events",
    tabLabel: "Promote Events",
    headline: "Promote Events People Can Plan Around",
    copy: "From trivia nights and live music to wine tastings and industry nights, create recurring events once and let people discover what's happening before they ever walk through your door.",
    outcome: "Turn first-time visitors into regulars.",
    visual: <ProductTourEventsVisual />,
  },
  {
    id: "see-your-results",
    tabLabel: "See Results",
    headline: "See How Your Business Is Performing",
    copy: "See how many people are viewing your listing and engaging with your business, so you know what's working and where you can improve.",
    outcome: "Make informed decisions as you grow.",
    image: {
      src: "/images/business/business-page-analytics-1.png",
      alt: "Operator Admin analytics dashboard showing visibility, engagement, and intent metrics for a business's listing",
    },
  },
];

// ── Section 8: FAQ ────────────────────────────────────────────────────────────

export const BUSINESS_FAQS: FaqAccordionItem[] = [
  {
    id: "approval-time",
    question: "How long does approval take?",
    answer:
      "Most claim and add-venue requests are reviewed quickly, typically within one to two business days. You'll be notified as soon as your venue is approved.",
  },
  {
    id: "update-anytime",
    question: "Can I update my happy hours and events anytime?",
    answer:
      "Yes. Once your venue is approved, you're in control — update your specials, happy hours, events, and business information whenever they change, as often as you like.",
  },
  {
    id: "free-plan-permanent",
    question: "Is the Free plan really free?",
    answer:
      "Yes. Our Free plan is permanent—not a trial. There's no credit card required, no contracts, and no obligation to upgrade. You can continue using the Free plan for as long as it meets your business's needs, and upgrade at any time if you want additional features.",
  },
  {
    id: "claim-vs-add",
    question: "What's the difference between claiming a venue and adding a new one?",
    answer:
      "If your restaurant or bar is already listed on Happy Hour Compass, you'll claim your venue to take ownership of the existing profile and start managing its information.\n\n" +
      "If your business isn't listed yet, you'll add your venue and we'll create a new listing for you after it's reviewed.\n\n" +
      "In either case, once your request is approved, you'll have full control over your venue profile, happy hours, events, photos, and business information.",
    afterAnswer: <ClaimVsAddFaqLinks />,
  },
  {
    id: "how-do-i-know",
    question: "How do I know Happy Hour Compass is actually bringing me customers?",
    answer:
      "Every plan includes analytics on your venue's performance, from basic view counts up through search rankings and campaign stats on higher plans — so you can see how people are finding you.",
  },
  {
    id: "multiple-locations",
    question: "What if I manage multiple locations or a restaurant group?",
    answer:
      "Get in touch and we'll help you set up every location and find the right plan for a group of your size.",
  },
  {
    id: "contract",
    question: "Are we locked into a long-term contract?",
    answer:
      "No. There are no contracts and no credit card required to start. Paid plans are billed month to month, and you can change or cancel anytime.",
  },
  {
    id: "discounts-only",
    question: "Will Happy Hour Compass only attract customers looking for discounts?",
    answer:
      "You're not creating additional discounts or reducing your margins. You're simply making it easier for people to discover the happy hours and events you already offer. Happy hour may introduce someone to your venue, but it's your food, drinks, service, and atmosphere that turn first-time visitors into regulars.",
  },
  {
    id: "already-on-social",
    question: "Why should I use Happy Hour Compass if I already use social media?",
    answer:
      "Social media reaches people who already follow you. Happy Hour Compass reaches people who don't know you yet but are actively looking for somewhere to go right now — discovery, not just an existing audience.",
  },
];
