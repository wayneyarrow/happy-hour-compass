import type { HelpSection, HelpStep } from "./types";
import type { OperatorVenueOrigin } from "./gettingStartedOrigin";

/**
 * Getting Started content.
 *
 * The claimed-seed variant (CLAIMED_SEED_CONTENT below) is the V1 approved
 * Help Center design/content reference — see the task brief for the approved
 * copy. The submitted variant (APPROVED_SUBMISSION_CONTENT) is now also
 * approved, reviewed copy following that same structure and treatment. Both
 * render without the "Draft" badge (`isDraft: false`).
 *
 * The `unknown` variant is still the original scaffold-quality placeholder
 * copy from the initial Help Center foundation task — a short step list that
 * proves the per-origin architecture works, not reviewed content. It keeps
 * rendering the "Draft" badge (`isDraft` defaults to true when omitted)
 * until its own approved copy lands in a follow-up task.
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
  title: "Getting started with your submitted venue",
  isDraft: false,
  intro:
    "Your venue has been approved and you now have access to Operator Admin. Your next step is to finish setting up your listing and make sure it's ready for guests.",
  leadSection: {
    heading: "Start with Venue Growth & Readiness",
    body: [
      "When you sign in, Home takes you to your Venue Growth & Readiness dashboard — your built-in guide for getting your venue ready on Happy Hour Compass.",
    ],
    listIntro: "It helps you:",
    list: [
      "see what you need to complete before your venue can be published",
      "jump directly to the right place to add or update information",
      "keep track of what's already complete",
      "see ways to improve your listing after the essentials are done",
    ],
    afterList: [
      "You don't need to figure out what to do next. Start at the top of the dashboard and work your way through the recommendations.",
      "As you make changes, the dashboard updates with you. If you're ever unsure what to work on next, come back to Home.",
    ],
    screenshot: {
      src: "/help/screenshots/submitted-getting-started-dashboard.png",
      alt: "Venue Growth & Readiness dashboard overview for a submitted venue, showing Required to publish items and progress toward publishing.",
      width: 1162,
      height: 575,
    },
  },
  steps: [
    {
      title: "Complete anything required to publish",
      body: [
        "Start with anything listed under Required to publish. These are the essential items your venue needs before it can be published on Happy Hour Compass.",
        "Select the action beside an incomplete item to go directly to the right place in Operator Admin. Once the requirements are complete, your venue can be made available to guests.",
      ],
      note: {
        heading: "Good to know",
        text: "You don't need to complete every recommendation before your venue can go live. Focus on Required to publish first. The remaining recommendations help you make your listing more complete and useful to guests.",
      },
    },
    {
      title: "Review your venue details",
      body: [
        "Some of your venue information was carried over from your submission. Take a moment to make sure the important details are still correct.",
        "Review your business details, including your venue name, address and contact information, and confirm that the venue type accurately describes your business.",
        "If anything has changed since you submitted your venue, update it before publishing.",
      ],
      screenshot: {
        src: "/help/screenshots/submitted-getting-started-profile-items.png",
        alt: "Important profile items list for a submitted venue, showing business details and venue type review items.",
        width: 862,
        height: 575,
      },
    },
    {
      title: "Finish your listing",
      body: [
        "Once the essentials are complete, work through Finish your listing.",
        "This is where the dashboard helps you add the information guests are most likely to use when deciding where to go — such as your business hours, Happy Hour specials and menu.",
        "You don't have to complete everything at once. Add what you have now and come back anytime as your listing evolves.",
      ],
    },
    {
      title: "Keep improving",
      body: [
        "Once your core listing is in place, the dashboard will continue to suggest ways to make it more complete and discoverable.",
        "Use the recommendations under Keep optimizing to add useful details such as your website, social profiles and other enhancements available to your venue.",
        "These items aren't required to get started. Work through them as time allows.",
      ],
    },
    {
      title: "Preview what guests see",
      body: [
        "Use Preview public listing near the top of your dashboard to see how your venue will appear to Happy Hour Compass visitors.",
        "Preview your listing as you build it and check the information guests rely on most — especially your Happy Hour, business hours, images and contact details.",
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
      "You don't need to build the perfect listing all at once.",
      "Start with Required to publish, review your important venue details, and then work through the remaining recommendations as time allows.",
      "Your Venue Growth & Readiness dashboard will keep guiding you toward what to do next.",
    ],
  },
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
