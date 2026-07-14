import type { ReactNode } from "react";
import type { Step } from "@/app/(website)/NumberedStepList";
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

// ── Section 2: How It Works ──────────────────────────────────────────────────

export const HOW_IT_WORKS_STEPS: readonly Step[] = [
  {
    number: 1,
    title: "Claim or Create Your Venue",
    description: "Find your venue and claim it, or add a brand-new listing in minutes.",
  },
  {
    number: 2,
    title: "Add Happy Hours & Events",
    description: "Add your specials, happy hours, and events — you control every detail.",
  },
  {
    number: 3,
    title: "We Help Customers Discover You",
    description: "Your venue appears to people nearby who are already looking for somewhere to go.",
  },
];

// ── Section 4: Why Venues Choose Happy Hour Compass ──────────────────────────

export type Pillar = {
  id: string;
  title: string;
  headline: string;
  points: string[];
  icon: ReactNode;
};

export const PILLARS: Pillar[] = [
  {
    id: "more-guests",
    title: "More Guests",
    headline: "Reach people already searching for somewhere to go.",
    points: [
      "Surfaced to nearby customers actively looking for a happy hour",
      "Local discovery, not interruptive advertising",
    ],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" className="w-7 h-7">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
      </svg>
    ),
  },
  {
    id: "easy-to-manage",
    title: "Easy to Manage",
    headline: "Updating your venue should take minutes — not hours.",
    points: [
      "Straightforward specials, events, and profile editor",
      "No training required to keep your listing current",
    ],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" className="w-7 h-7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    ),
  },
  {
    id: "in-control",
    title: "You're in Control",
    headline: "You control specials, events, branding, and visibility.",
    points: [
      "Nothing changes on your listing without you",
      "Update or pause anything, anytime",
    ],
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" className="w-7 h-7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      </svg>
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
