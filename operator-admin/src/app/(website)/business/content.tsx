import type { ReactNode } from "react";
import type { HowItWorksPanel } from "./HowItWorksPanels";
import type { JourneyMilestone } from "@/app/(website)/JourneyTimeline";
import type { ProductTourSlide } from "@/app/(website)/ProductTour";
import type { FaqAccordionItem } from "@/app/(website)/FaqAccordion";

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
    title: "Get Your Venue on Happy Hour Compass",
    detail: "Claim or create your listing.",
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
    detail: "A beautiful consumer experience, local discovery, and SEO for your happy hours and events.",
    icon: <MilestoneIcon d="M21 21l-4.35-4.35M18 11a7 7 0 11-14 0 7 7 0 0114 0z" />,
  },
  {
    id: "welcome-more-guests",
    title: "Welcome More Guests",
    detail: "More people finding their way to your door.",
    icon: <MilestoneIcon d="M12 21c-4-3-7-6-7-10a7 7 0 0114 0c0 4-3 7-7 10z" />,
  },
];

// ── Section 6: See Happy Hour Compass in Action (product tour) ──────────────

export const TOUR_SLIDES: ProductTourSlide[] = [
  {
    id: "get-started",
    tabLabel: "Get Started",
    headline: "Get your venue on Happy Hour Compass.",
    copy: "Whether you're claiming an existing listing we've already created or adding a brand-new venue, getting started only takes a few minutes. Once approved, you'll have full control over your venue profile, happy hours, events, and business information.",
    outcome: "Be online in minutes.",
  },
  {
    id: "manage-specials",
    tabLabel: "Manage Specials",
    headline: "Keep your happy hours and specials up to date.",
    copy: "Add and edit your food and drink specials whenever they change — no waiting on anyone else to update your listing.",
    outcome: "Keep your customers informed.",
  },
  {
    id: "list-events",
    tabLabel: "List Events",
    headline: "List recurring events people can plan around.",
    copy: "Trivia nights, live music, industry nights — set them up once and let people discover what's on before they ever walk in.",
    outcome: "Turn first-time visitors into regulars.",
  },
  {
    id: "measure-success",
    tabLabel: "Measure Success",
    headline: "See how your venue is performing.",
    copy: "Track views and engagement on your listing so you know what's working and what to adjust.",
    outcome: "Make informed decisions as you grow.",
  },
];

// ── Section 8: FAQ ────────────────────────────────────────────────────────────

export const BUSINESS_FAQS: FaqAccordionItem[] = [
  {
    id: "claim-vs-add",
    question: "What's the difference between claiming a venue and adding a new one?",
    answer:
      "Claiming is for venues that already have a listing on Happy Hour Compass — it hands you control of an existing page. Adding a new venue is for restaurants and bars that aren't listed yet. Either way, you end up with full control over your profile, happy hours, events, and business information.",
  },
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
