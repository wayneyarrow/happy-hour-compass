import type { HelpSection, HelpStep } from "./types";
import type { OperatorVenueOrigin } from "./gettingStartedOrigin";

/**
 * Getting Started content.
 *
 * The claimed-seed variant (CLAIMED_SEED_CONTENT below) is the first
 * approved, reviewed Getting Started article — see the task brief for the
 * approved copy. It is rendered without the "Draft" badge (`isDraft: false`).
 *
 * The other two variants (approved_submission, unknown) are still the
 * original scaffold-quality placeholder copy from the initial Help Center
 * foundation task — short step lists that prove the per-origin architecture
 * works, not reviewed content. They keep rendering the "Draft" badge
 * (`isDraft` defaults to true when omitted) until their own approved copy
 * lands in a follow-up task.
 */
export type GettingStartedContent = {
  /** Overrides the page's default "Getting Started" heading. */
  title?: string;
  intro: string;
  /** Unnumbered section rendered before the numbered steps. */
  leadSection?: HelpSection;
  steps: HelpStep[];
  /** Unnumbered section rendered after the numbered steps. */
  closingSection?: HelpSection;
  goodToKnow?: string[];
  /** Controls the "Draft" badge. Defaults to true (draft) when omitted. */
  isDraft?: boolean;
};

const CLAIMED_SEED_CONTENT: GettingStartedContent = {
  title: "Getting started with your claimed venue",
  isDraft: false,
  intro:
    "Your venue already has information on Happy Hour Compass. Now that you've claimed it, your first job is to review that information, make any necessary updates, and complete your listing.",
  leadSection: {
    heading: "Start with Venue Growth & Readiness",
    body: [
      "When you sign in, Home takes you to your Venue Growth & Readiness dashboard — your built-in guide for managing your venue on Happy Hour Compass.",
    ],
    listIntro: "It helps you:",
    list: [
      "see what needs your attention first",
      "jump directly to the right place to make an update",
      "keep track of what's complete",
      "know what to work on next",
    ],
    afterList: [
      "You don't need to figure everything out on your own. Start with anything required for your listing, then work through the recommendations that make your venue more complete and useful to guests.",
      "As you make changes, the dashboard updates with you. If you're ever unsure what to do next, come back to Home.",
    ],
    screenshot: {
      src: "/help/screenshots/claimed-getting-started-dashboard.png",
      alt: "Venue Growth & Readiness dashboard overview showing what needs attention and direct links to each area to review.",
      width: 1107,
      height: 843,
    },
  },
  steps: [
    {
      title: "Complete anything required to publish",
      body: [
        "Start with anything listed under Required to publish.",
        "Your venue may already show as Live when you first claim it. That's because Happy Hour Compass may have already added the basic information and a temporary venue image needed to create your listing.",
        "One of the first things we recommend is uploading your own venue images. Your photos help guests recognize your business and give you control over how your venue's brand and atmosphere are represented on Happy Hour Compass.",
        "Select the action beside an incomplete item to go directly to the area where you can complete it.",
      ],
      note: {
        heading: "Good to know",
        text: "Claiming your venue doesn't mean you need to rebuild your listing from scratch. Start by reviewing what's already there, replace temporary content such as the venue image with your own, and update anything that doesn't accurately represent your business.",
      },
    },
    {
      title: "Review your imported information",
      body: [
        "Because your venue existed on Happy Hour Compass before you claimed it, some information was added from publicly available sources.",
        "Review the items under Important profile items and make sure they accurately represent your business.",
        "This can include:",
      ],
      list: [
        "business details",
        "venue type",
        "business hours",
        "Happy Hour times",
        "Happy Hour specials",
        "website",
        "phone number",
      ],
      afterList: [
        "Use the action beside each item to review it. Once you're satisfied that the information is correct, mark the item as reviewed.",
      ],
      screenshot: {
        src: "/help/screenshots/claimed-getting-started-review-items.png",
        alt: "Important profile items list on the Venue Growth & Readiness dashboard, each with an action to review it and mark it reviewed.",
        width: 1107,
        height: 784,
      },
    },
    {
      title: "Improve your listing",
      body: [
        "Once the important information is accurate, work through the recommendations under Improve your listing.",
        "These aren't necessarily required to operate your listing, but completing them can make your venue more useful and discoverable to guests.",
        "Your dashboard will continue to show what you've completed and what you can improve next.",
      ],
    },
    {
      title: "Preview what guests see",
      body: [
        "Use Preview public listing near the top of your dashboard to see your venue the way Happy Hour Compass visitors see it.",
        "This is a good final check after making changes.",
        "Make sure the information guests rely on most — especially your Happy Hour, business hours, images and contact details — looks accurate.",
      ],
    },
    {
      title: "Use the Operator Admin menu",
      body: [
        "Your dashboard gives you shortcuts to important actions, but you can also manage your venue at any time from the main menu:",
      ],
      list: [
        "Venue — manage your business information, hours, links, images and other venue details.",
        "Happy Hours — manage your Happy Hour schedule and food and drink specials.",
        "Events — create and manage events at your venue.",
        "Analytics — see how guests are engaging with your listing.",
        "Subscription — view your current plan and available features.",
        "Users — manage the people who can access your venue.",
        "Help — find instructions and support when you need them.",
      ],
    },
  ],
  closingSection: {
    heading: "You're ready to go",
    body: [
      "You don't need to complete everything at once.",
      "Start with Required to publish, review the information Happy Hour Compass already has for your venue, and then work through the remaining recommendations as time allows.",
      "Your Venue Growth & Readiness dashboard will keep showing you what needs attention.",
    ],
  },
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
