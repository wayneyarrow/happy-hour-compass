import type { HowToArticle } from "./types";

/**
 * Standard How-To Article registry — Operator Admin Help Center, V1.
 *
 * This is the entire content model for How-To articles: a plain array of
 * data objects rendered through the single shared route at
 * src/app/admin/help/[slug]/page.tsx. Adding a real article later means
 * appending an object here — no new page, no new routing logic.
 *
 * "Manage your venue information", "Manage your venue images", "Publish or
 * unpublish your venue", "Manage your Happy Hours", "Create an event",
 * "Manage your events", and "Understand subscriptions and limits" (below)
 * are the real, approved How-To articles, following the design/content
 * standard established by the Getting Started guides. They're listed first,
 * under the "Managing Your Venue" category, so they display above the
 * Internal Preview category on the landing page — each reuses this same
 * category rather than a new one, since it's still an operator managing a
 * feature area of their venue via the same Operator Admin main menu. The two
 * Internal Preview entries after them are placeholders that exist only to
 * prove the renderer, optional-section behavior, screenshot presentation,
 * and related-article linking work end-to-end. They are marked
 * `isPlaceholder: true` (rendered with a visible "Internal preview" badge)
 * and must not be treated as approved Help Center content — kept for now per
 * the task brief, to be removed once enough real articles exist.
 */
export const HOW_TO_ARTICLES: HowToArticle[] = [
  {
    type: "how-to",
    slug: "manage-venue-information",
    title: "Manage your venue information",
    summary:
      "Your Venue page is where you manage the core information guests use to understand your business — from your business details and description to your hours and useful links. Keep this information current so guests know what to expect before they visit.",
    category: "Managing Your Venue",
    steps: [
      {
        title: "Open your Venue page",
        body: [
          "From Operator Admin, select Venue from the main menu.",
          "The page is divided into sections so you can update different parts of your listing independently.",
        ],
      },
      {
        title: "Update your business details",
        body: [
          "Use Business details to manage the basic information that identifies your venue, including your venue name, location and venue type.",
          "Review this information carefully, particularly if your venue was originally added to Happy Hour Compass before you took ownership of the listing.",
          "Select Save details after making changes.",
        ],
        screenshot: {
          src: "/help/screenshots/manage-venue-information-business-details.png",
          alt: "Business details section of the Venue page, showing venue name, address, contact information and venue type fields.",
          width: 1078,
          height: 904,
        },
      },
      {
        title: "Tell guests about your venue",
        body: [
          "Use About your venue to give guests a quick sense of what makes your business worth visiting.",
          "Keep it useful and concise. Describe the experience, atmosphere or features that help someone decide whether your venue is right for them.",
        ],
      },
      {
        title: "Keep your business hours accurate",
        body: [
          "Use Business hours to keep your regular opening and closing times accurate.",
          "Review each day of the week and update your hours whenever your regular schedule changes.",
        ],
        note: {
          heading: "Good to know",
          text: "Business hours are your venue's regular operating hours. Your Happy Hour schedule is managed separately under Happy Hours.",
        },
        screenshot: {
          src: "/help/screenshots/manage-venue-information-business-hours.png",
          alt: "Business hours section of the Venue page, showing open and close times for each day of the week.",
          width: 1039,
          height: 834,
        },
      },
      {
        title: "Add payment information",
        body: [
          "Use Payment types to show guests which payment methods your venue accepts.",
          "Select the methods that apply to your business and save your changes.",
        ],
      },
      {
        title: "Add useful links",
        body: [
          "Use Links to add destinations that help guests learn more about your venue or take the next step.",
          "Currently, you can add your website and a link to your menu.",
          "Keep these links current. If a destination changes, update it here so guests aren't sent to an outdated page.",
        ],
      },
    ],
    closingSection: {
      heading: "Keep your information current",
      body: [
        "Your venue information can be updated anytime.",
        "Review it whenever your hours, contact details, links or other business information changes so guests always see accurate information on Happy Hour Compass.",
      ],
    },
  },
  {
    type: "how-to",
    slug: "manage-venue-images",
    title: "Manage your venue images",
    summary:
      "Your venue images help guests understand what your business looks and feels like before they visit. Use Venue images to upload your own photography, choose the image that represents your venue first, and remove images you no longer want to use.",
    category: "Managing Your Venue",
    steps: [
      {
        title: "Open Venue images",
        body: [
          "From Operator Admin, select Venue from the main menu and scroll to Venue images.",
          "This is where you can add and manage the images used to represent your venue on Happy Hour Compass.",
        ],
      },
      {
        title: "Upload your images",
        body: [
          "Select Upload images and choose the photos you want to add to your venue.",
          "Your current image count and image allowance are shown in the Venue images section, so you can see how many images you have added and whether you have room for more.",
          "Happy Hour Compass accepts JPEG, PNG, WebP, and GIF image files.",
        ],
        note: {
          heading: "Good to know",
          text: "If Happy Hour Compass originally provided an image for your venue, replace it with your own photography when you can. Your own images give you control over how your brand, atmosphere and venue are represented to guests.",
        },
        screenshot: {
          src: "/help/screenshots/manage-venue-images-gallery.png",
          alt: "Venue images gallery showing the upload control, image count, and management controls for each uploaded photo.",
          width: 724,
          height: 393,
        },
      },
      {
        title: "Choose your primary image",
        body: [
          "Your primary image is the first image guests see representing your venue.",
          "To change it, select Set primary on the image you want to use. The selected image becomes your primary image, moves to the front of your gallery, and is identified with the Primary label.",
          "Choose a clear, representative photo that gives guests a strong first impression of your venue.",
        ],
        screenshot: {
          src: "/help/screenshots/manage-venue-images-primary.png",
          alt: "Venue images gallery after selecting a different image as primary, showing the Primary label on the newly selected image.",
          width: 724,
          height: 393,
        },
      },
      {
        title: "Remove images you no longer want",
        body: [
          "Remove images that are outdated or no longer represent your venue.",
          "Use the delete control on the image you want to remove and follow any confirmation shown by Operator Admin.",
          "If you delete your primary image, the next image in your gallery automatically becomes your new primary image.",
        ],
        note: {
          heading: "Good to know",
          text: "Deleting your only remaining image will unpublish your venue, since a published listing must have at least one image. Upload a new image to republish.",
        },
      },
    ],
    closingSection: {
      heading: "Keep your images fresh",
      body: [
        "Update your venue images whenever your space, branding or guest experience changes.",
        "A small collection of current, representative photos helps guests know what to expect and gives you control over how your venue appears on Happy Hour Compass.",
      ],
    },
    relatedSlugs: ["manage-venue-information"],
  },
  {
    type: "how-to",
    slug: "publish-unpublish-venue",
    title: "Publish or unpublish your venue",
    summary:
      "The Publish setting controls whether your venue is available to guests on Happy Hour Compass. Publishing makes your listing live and visible in search; unpublishing takes it down without deleting any of your venue information.",
    category: "Managing Your Venue",
    steps: [
      {
        title: "Open the Publish section",
        body: [
          "From Operator Admin, select Venue from the main menu and scroll down to Publish.",
          "This is where you control whether your venue is visible to guests on Happy Hour Compass.",
        ],
        screenshot: {
          src: "/help/screenshots/publish-venue-published.png",
          alt: "Publish section of the Venue page, showing the Publish toggle switched to Published.",
          width: 723,
          height: 305,
        },
      },
      {
        title: "Unpublish your venue",
        body: [
          "Switch the setting to Unpublished, then select Save.",
          "Unpublishing removes your venue from search and hides your public venue page from guests. Your venue information isn't deleted — everything you've entered stays saved in Operator Admin, and you can preview your listing and republish anytime.",
          "Your venue can also be unpublished automatically — for example, if you remove your only remaining venue image, since a published listing must have at least one image.",
        ],
        screenshot: {
          src: "/help/screenshots/publish-venue-unpublished.png",
          alt: "Publish section of the Venue page, showing the Publish toggle switched to Unpublished, with a note that the venue is visible only to the operator until published.",
          width: 723,
          height: 305,
        },
      },
      {
        title: "Publish your venue",
        body: [
          "Switch the setting to Published, then select Save.",
          "If your venue doesn't yet meet the requirements to publish, Operator Admin will show you what's missing so you can complete it and try again.",
        ],
        note: {
          heading: "Good to know",
          text: "Your venue needs at least one image and at least one active Happy Hour before it can be published. If any requirements are missing, Operator Admin will show you exactly what to complete.",
        },
      },
    ],
    closingSection: {
      heading: "Keep your listing published",
      body: [
        "You can publish or unpublish your venue anytime — your venue information is never deleted when you do.",
        "If your venue becomes unpublished, review the Publish section for anything that needs attention, then republish when you're ready.",
      ],
    },
    relatedSlugs: ["manage-venue-images"],
  },
  {
    type: "how-to",
    slug: "manage-happy-hours",
    title: "Manage your Happy Hours",
    summary:
      "Happy Hours is where you manage your Happy Hour schedule and the food and drink specials guests see on your listing. Each section saves independently, so select Save in each section you edit.",
    category: "Managing Your Venue",
    steps: [
      {
        title: "Add your Happy Hour tagline",
        body: [
          "Your tagline is a short, optional summary shown at the top of your Happy Hour listing.",
          "From Operator Admin, select Happy Hours from the main menu and open Tagline.",
          "Enter your tagline, then select Save tagline.",
        ],
      },
      {
        title: "Set your Happy Hour times",
        body: [
          "Open Happy Hour Times to set when your Happy Hour is active.",
          "Set the days and times for your Happy Hour, or select No happy hour for days when you don't offer one. You can add up to two time ranges per day — useful for separate afternoon and late-night Happy Hours.",
          "When you're finished, select Save times.",
        ],
        note: {
          heading: "Tip: Apply schedule to multiple days",
          text: "If several days share the same schedule, use Apply schedule to multiple days to set the times once and apply them to the days you choose — quickly select All days, Weekdays, or Weekends. Applying a schedule replaces the existing times for those days, so review your changes, then select Save times.",
          screenshot: {
            src: "/help/screenshots/manage-happy-hours-apply-multiple-days.png",
            alt: "Apply schedule to multiple days panel expanded, showing day selection buttons, All days/Weekdays/Weekends presets, and a start and end time to apply to the selected days.",
            width: 678,
            height: 441,
          },
        },
        screenshot: {
          src: "/help/screenshots/manage-happy-hours-times.png",
          alt: "Happy Hour Times section showing the weekly schedule, including a day with two time ranges and the collapsed Apply schedule to multiple days panel.",
          width: 678,
          height: 901,
        },
      },
      {
        title: "Add food specials",
        body: [
          "Open Food specials to add the food deals guests will see on your listing.",
          "Select + Add food item to add a row, then enter the item name, price, and any optional notes — like dietary info or portion size. Use the trash icon beside a row to remove it.",
          "Your plan determines how many food specials you can add. Operator Admin shows your current count and lets you know if you need to upgrade to add more.",
          "Select Save food specials when you're done.",
        ],
        screenshot: {
          src: "/help/screenshots/manage-happy-hours-food-specials.png",
          alt: "Food specials section showing three added items with name, price and notes fields, the item count against the plan allowance, and an upgrade prompt at the limit.",
          width: 663,
          height: 452,
        },
      },
      {
        title: "Add drink specials",
        body: [
          "Drink specials work the same way as food specials. Open Drink specials, select + Add drink item to add your drink deals, and select Save drink specials when you're done.",
          "Drink specials have their own separate item count and plan allowance from food specials.",
        ],
        screenshot: {
          src: "/help/screenshots/manage-happy-hours-drink-specials.png",
          alt: "Drink specials section showing three added items with name, price and notes fields, the item count against the plan allowance, and an upgrade prompt at the limit.",
          width: 663,
          height: 452,
        },
      },
    ],
    closingSection: {
      heading: "Keep your Happy Hour current",
      body: [
        "Update your schedule and specials whenever your Happy Hour changes, so guests always see accurate information.",
        "Remember that a published venue needs at least one active Happy Hour — removing your last one will unpublish your venue.",
      ],
    },
    relatedSlugs: ["publish-unpublish-venue"],
  },
  {
    type: "how-to",
    slug: "create-event",
    title: "Create an event",
    summary:
      "Create an event to promote something happening at your venue — live music, trivia, a special night, and more. The event details you enter here are what guests see on Happy Hour Compass, so keep them accurate and inviting.",
    category: "Managing Your Venue",
    steps: [
      {
        title: "Start a new event",
        body: [
          "From Operator Admin, select Events from the main menu, then select + New event.",
          "Enter your event name and select Continue. This creates your event as a draft — you'll add the schedule, image, and other details next.",
        ],
      },
      {
        title: "Add the event details",
        body: [
          "Under Event Basics, confirm your Event name, then choose an Event type — like Live Music, Trivia, or Food & Drink — that best describes what's happening.",
          "Add Event details to tell guests more about the event. This is optional, but it helps guests know what to expect.",
        ],
        screenshot: {
          src: "/help/screenshots/create-event-details.png",
          alt: "Event Basics section of the event form, showing Event name, Event type, and optional Event details fields.",
          width: 996,
          height: 378,
        },
      },
      {
        title: "Add an event image",
        body: [
          "Upload a photo that represents your event — it appears on both the event listing and its detail page.",
          "An event image isn't required to save your event as a draft, but it is required before you can publish.",
        ],
        screenshot: {
          src: "/help/screenshots/create-event-image.png",
          alt: "Event image field showing an uploaded photo with Replace image and Remove image controls.",
          width: 405,
          height: 168,
        },
      },
      {
        title: "Set the event schedule",
        body: [
          "Set the Date of first occurrence and choose a Start time — both are required to save your event. End time is optional; if you set one, it must be later in the day than your start time.",
          "Operator Admin shows a preview of your schedule as you enter it, so you can confirm it reads the way you expect.",
        ],
        note: {
          heading: "Tip: Make an event recurring",
          text: "If your event happens on a regular schedule, use Repeats to set it as Daily, Weekly, or Monthly instead of re-creating it each time — your date of first occurrence sets the pattern, so a weekly event repeats on that same day of the week. Recurring events are available on plans that include recurring events. If your current plan doesn't include recurring events, you'll see an option to upgrade.",
        },
        screenshot: {
          src: "/help/screenshots/create-event-schedule.png",
          alt: "Schedule section of the event form, showing Date of first occurrence, Start time, End time, Repeats, and a date and time preview.",
          width: 962,
          height: 372,
        },
      },
      {
        title: "Add ticketing and guest information",
        body: [
          "If tickets are required, check Enable Ticket Sales, then add a Ticket URL — a link to the external site where guests can buy tickets, such as Eventbrite. Happy Hour Compass doesn't sell tickets directly; it links guests out to complete their purchase.",
          "If tickets sell out, check Sold Out to show guests that instead of the ticket link.",
          "Add a Price to give guests a sense of cost, like Free, $20, or By Donation — this field is optional.",
          "Use Know Before You Go to add helpful details guests may want before attending, such as age restrictions, reservation information, parking notes, and accessibility information. All of these fields are optional.",
        ],
        screenshot: {
          src: "/help/screenshots/create-event-ticketing-links.png",
          alt: "Tickets and Know Before You Go sections of the event form, showing ticketing controls alongside age restriction, reservations, parking notes, and accessibility notes fields.",
          width: 964,
          height: 590,
        },
      },
      {
        title: "Publish the event",
        body: [
          "Under Publishing, switch the setting to Published when you're ready for guests to see your event, or leave it Unpublished to keep working on it privately.",
          "To publish, your event needs an Event type and an Event image — Operator Admin will let you know if either is missing.",
          "Select Save changes. You'll stay on this event afterward, so you can keep adding details or come back to it anytime from your events list.",
        ],
        screenshot: {
          src: "/help/screenshots/create-event-publish.png",
          alt: "Publishing section of the event form, showing the Published/Unpublished toggle and Save changes button.",
          width: 455,
          height: 158,
        },
      },
    ],
    closingSection: {
      heading: "Keep your event details accurate",
      body: [
        "Update your event if its schedule, image, or details change, so guests always see accurate information.",
        "Accurate event details help guests know what to expect and give your event the best chance of turning into a visit.",
      ],
    },
  },
  {
    type: "how-to",
    slug: "manage-events",
    title: "Manage your events",
    summary:
      "Events lets you find events you've already created, update their details, preview how they look to guests, change whether they're published, and remove events you no longer need.",
    category: "Managing Your Venue",
    steps: [
      {
        title: "Find an event",
        body: [
          "From Operator Admin, select Events from the main menu. Your events are listed on the left, grouped by All, Upcoming, Expired, Recurring, Draft, and Published, so you can quickly find the one you're looking for.",
          "Select an event from the list to open it in the editor on the right.",
        ],
        screenshot: {
          src: "/help/screenshots/manage-events-list.png",
          alt: "Events list with a Published event selected, showing the filter tabs (All, Upcoming, Expired, Recurring, Draft, Published) and the selected event open in the editor panel.",
          width: 1881,
          height: 831,
        },
      },
      {
        title: "Edit an event",
        body: [
          "Update any of the event's information — its details, image, schedule, ticketing, or guest information — the same way you set it up when you created the event. See Create an event for guidance on any of these fields.",
          "Select Save changes when you're done. You'll return to your events list, where you can select the event again anytime to keep working on it.",
          "Use Preview, near the top of the editor, to see the event exactly as guests will see it on Happy Hour Compass — even before it's published.",
        ],
        screenshot: {
          src: "/help/screenshots/manage-events-edit.png",
          alt: "Top of the event editor showing the Preview and Delete event actions above the Event Basics section.",
          width: 984,
          height: 744,
        },
      },
      {
        title: "Publish or unpublish an event",
        body: [
          "Under Publishing, switch the setting to Published when you're ready for guests to see the event, or back to Unpublished to take it down without deleting anything.",
          "To publish, the event needs an Event type and an Event image — Operator Admin will let you know if either is missing.",
          "Select Save changes to apply the change.",
        ],
        screenshot: {
          src: "/help/screenshots/manage-events-publishing.png",
          alt: "Publishing section of the event editor showing the Published toggle and Save changes button.",
          width: 697,
          height: 199,
        },
      },
      {
        title: "Delete an event",
        body: [
          "Select Delete event, near the top of the editor, to permanently remove an event. You'll be asked to confirm — this action can't be undone.",
          "If the event is a recurring event that Happy Hour Compass created for your venue, the confirmation will also let you know that deleting it may affect your ability to create another recurring event unless your plan includes them.",
          "Once deleted, the event is removed from your events list immediately.",
        ],
      },
    ],
    closingSection: {
      heading: "Keep your events up to date",
      body: [
        "Revisit your events whenever plans change, so guests always see accurate schedules and details.",
        "An outdated event is easy to update — just select it from your list and make your changes.",
      ],
    },
    relatedSlugs: ["create-event"],
  },
  {
    type: "how-to",
    slug: "understand-subscriptions-and-limits",
    title: "Understand subscriptions and limits",
    summary:
      "Your venue's subscription plan determines the features and usage allowances available to it. The Subscription page shows your current plan and how much of it you're using.",
    category: "Managing Your Venue",
    steps: [
      {
        title: "Check your current plan and usage",
        body: [
          "From Operator Admin, select Subscription from the main menu. The Current Plan card shows your plan and status.",
          "Plan Usage shows how much of your plan you're currently using — Images, Food Specials, Drink Specials, Search Tags, Users, and Active Events — along with any features not included in your current plan.",
        ],
        note: {
          heading: "Good to know",
          text: "If you reach a limit, Plan Usage will show it clearly. You can remove something you no longer need to make room, or select Change Plan for more capacity.",
        },
        screenshot: {
          src: "/help/screenshots/subscriptions-plan-usage.png",
          alt: "Subscription page showing the Current Plan card and Plan Usage, including items at their plan limit and a feature not included in the current plan.",
          width: 833,
          height: 823,
        },
      },
      {
        title: "Compare plans",
        body: [
          "Select Change Plan to see how Free, Pro, and Premium compare side by side, including pricing and what's included in each.",
          "Use the comparison to choose the plan that fits your venue.",
        ],
        screenshot: {
          src: "/help/screenshots/subscriptions-compare-plans.png",
          alt: "Change Plan modal comparing Free, Pro, and Premium plans side by side, with pricing and included features for each.",
          width: 881,
          height: 858,
        },
      },
      {
        title: "Upgrade your plan",
        body: [
          "Select the plan you want. You'll see a summary of what you'll unlock, then select Continue to complete payment securely through Stripe.",
          "After payment, you'll return to Subscription — your upgrade may take a moment to activate.",
          "If you're already on a paid plan, use Manage Billing on the Subscription page to update your payment method or manage your subscription directly through Stripe.",
        ],
        screenshot: {
          src: "/help/screenshots/subscriptions-confirm-upgrade.png",
          alt: "Confirmation screen for upgrading to Pro, showing what the plan unlocks and a Continue button that proceeds to Stripe.",
          width: 881,
          height: 483,
        },
      },
    ],
    closingSection: {
      heading: "Choose the plan that fits your venue",
      body: [
        "Your subscription plan can change as your venue's needs change.",
        "Return to Subscription anytime to review your usage or manage your plan.",
      ],
    },
    relatedSlugs: ["manage-venue-images", "manage-happy-hours"],
  },
  {
    type: "how-to",
    slug: "sample-article-renderer-check",
    title: "Sample Article — Renderer Check",
    summary: "Demonstrates every section of the How-To article layout, including a step screenshot.",
    category: "Internal Preview",
    isPlaceholder: true,
    beforeYouStart: [
      "This is placeholder copy used only to verify the \"Before you start\" section renders.",
    ],
    steps: [
      {
        title: "This is a sample step",
        body: [
          "Sample step body text — verifies a step with no screenshot renders cleanly.",
        ],
      },
      {
        title: "This is a sample step with a screenshot",
        body: [
          "Sample step body text — verifies a step's optional screenshot renders responsively below its instructions.",
        ],
        screenshot: {
          src: "/help/placeholder-screenshot.png",
          alt: "Abstract placeholder graphic standing in for a future real Operator Admin screenshot.",
          width: 1200,
          height: 750,
        },
      },
    ],
    whatHappensNext: "Placeholder copy verifying the optional \"What happens next?\" section renders.",
    goodToKnow: [
      "Placeholder copy verifying the optional \"Good to know\" section renders as a list.",
    ],
    relatedSlugs: ["sample-article-minimal"],
  },
  {
    type: "how-to",
    slug: "sample-article-minimal",
    title: "Sample Article — Minimal Sections",
    summary: "Demonstrates that every optional section cleanly disappears when it has no content.",
    category: "Internal Preview",
    isPlaceholder: true,
    // No beforeYouStart, whatHappensNext, or goodToKnow — proves those
    // sections render nothing rather than an empty heading/card.
    steps: [
      {
        title: "Only the required sections render",
        body: [
          "This article intentionally omits every optional section to verify they disappear cleanly instead of rendering empty.",
        ],
      },
    ],
    relatedSlugs: ["sample-article-renderer-check"],
  },
];

/** Slugs reserved by other Help Center routes — never valid as an article slug. */
const RESERVED_SLUGS = new Set(["getting-started"]);

export function getArticleBySlug(slug: string): HowToArticle | undefined {
  if (RESERVED_SLUGS.has(slug)) return undefined;
  return HOW_TO_ARTICLES.find((article) => article.slug === slug);
}

export function getAllArticleSlugs(): string[] {
  return HOW_TO_ARTICLES.map((article) => article.slug);
}

/** Resolves an article's relatedSlugs to full articles, capped at 3 per V1 spec. */
export function getRelatedArticles(article: HowToArticle): HowToArticle[] {
  const slugs = (article.relatedSlugs ?? []).slice(0, 3);
  return slugs
    .map((slug) => getArticleBySlug(slug))
    .filter((a): a is HowToArticle => !!a);
}

export function articleUrl(slug: string): string {
  return `/admin/help/${slug}`;
}
