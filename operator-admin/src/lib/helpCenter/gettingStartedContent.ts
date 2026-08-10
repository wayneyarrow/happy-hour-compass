import type { HelpStep } from "./types";
import type { OperatorVenueOrigin } from "./gettingStartedOrigin";

/**
 * Getting Started content — reusable structure only.
 *
 * Per the task brief, this is intentionally NOT the final Getting Started
 * guide. Each variant below is a short, scaffold-quality set of steps that
 * proves the architecture can present different content per operator/venue
 * origin (see gettingStartedOrigin.ts). The page renders a "Draft" badge
 * (matching the existing "Coming soon" badge pattern already used in
 * app/admin/home/modules/HelpModule.tsx) so this is never mistaken for
 * reviewed, final content. Replace the copy here — not the surrounding
 * structure — when the real Getting Started guide is written.
 */
export type GettingStartedContent = {
  intro: string;
  steps: HelpStep[];
  goodToKnow?: string[];
};

const CLAIMED_SEED_CONTENT: GettingStartedContent = {
  intro:
    "Your listing was created from imported venue data. Start by reviewing what's already there, then publish once it's accurate.",
  steps: [
    {
      title: "Review your imported venue details",
      body: [
        "Check your business details, hours, and photo — imported data may be out of date or incomplete.",
      ],
    },
    {
      title: "Review your happy hour times and specials",
      body: [
        "Confirm the imported happy hour schedule and specials match what you currently offer.",
      ],
    },
    {
      title: "Publish your listing",
      body: [
        "Once everything looks right, publish from Venue settings so guests can see it.",
      ],
    },
  ],
};

const APPROVED_SUBMISSION_CONTENT: GettingStartedContent = {
  intro:
    "Your venue was approved and your account is ready. Start by completing your profile, then publish when you're ready to go live.",
  steps: [
    {
      title: "Complete your venue profile",
      body: [
        "Add your business details, hours, and at least one photo.",
      ],
    },
    {
      title: "Add your happy hour times and specials",
      body: [
        "Set the days and times you run happy hour, plus your food and drink specials.",
      ],
    },
    {
      title: "Publish your listing",
      body: [
        "Once your profile is ready, publish from Venue settings so guests can see it.",
      ],
    },
  ],
};

const UNKNOWN_ORIGIN_CONTENT: GettingStartedContent = {
  intro:
    "Let's get your listing ready to publish. Your Home page tracks exactly what's left to complete.",
  steps: [
    {
      title: "Check your Home page checklist",
      body: [
        "Home shows the specific items left before your listing can go live.",
      ],
    },
    {
      title: "Complete your venue profile and happy hour details",
      body: [
        "Fill in your business details, hours, photo, and happy hour times and specials.",
      ],
    },
    {
      title: "Publish your listing",
      body: [
        "Once your profile is ready, publish from Venue settings so guests can see it.",
      ],
    },
  ],
};

const GETTING_STARTED_CONTENT: Record<OperatorVenueOrigin, GettingStartedContent> = {
  claimed_seed: CLAIMED_SEED_CONTENT,
  approved_submission: APPROVED_SUBMISSION_CONTENT,
  unknown: UNKNOWN_ORIGIN_CONTENT,
};

export function getGettingStartedContent(origin: OperatorVenueOrigin): GettingStartedContent {
  return GETTING_STARTED_CONTENT[origin];
}
