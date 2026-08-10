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
 * "Manage your events", "Understand subscriptions and limits", "Manage
 * users", "Understand analytics", and "Manage your Search Tags" (below) are
 * the real, approved How-To articles, following the design/content standard
 * established by the Getting Started guides. They're listed first, under
 * the "Managing Your Venue" category, so they display above the Internal
 * Preview category on the landing page — each reuses this same category
 * rather than a new one, since it's still an operator managing a feature
 * area of their venue via the same Operator Admin main menu. This is the
 * final planned real V1 How-To article. The two Internal Preview entries
 * after them are placeholders that exist only to prove the renderer,
 * optional-section behavior, screenshot presentation, and related-article
 * linking work end-to-end. They are marked
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
    slug: "manage-users",
    title: "Manage users",
    summary:
      "The Users page is where the Admin gives team members access to help manage the venue. Your subscription plan determines how many users your account can have.",
    category: "Managing Your Venue",
    steps: [
      {
        title: "Understand your team and plan usage",
        body: [
          "From Operator Admin, select Users from the main menu.",
          "Plan Usage shows how many users your account is currently using against your subscription's allowance.",
          "Active Users lists everyone with access to your operator account right now. Pending Invitations lists invitations that haven't been accepted yet — these count toward your user allowance too, the same as active users.",
        ],
        note: {
          heading: "Good to know",
          text: "The Admin is the account-level role responsible for users and other account-sensitive actions, like the subscription plan. Team members can help with day-to-day venue management — venue information, images, Happy Hours, specials and events — without needing Admin access.",
        },
        screenshot: {
          src: "/help/screenshots/manage-users-overview.png",
          alt: "Users page showing Plan Usage with the current plan and user allowance, Active Users with the Admin badge, and Pending Invitations.",
          width: 710,
          height: 480,
        },
      },
      {
        title: "Invite a team member",
        body: [
          "When a user slot is available, select Invite User.",
          "Full name is optional. Email address is required.",
          "Select Send invite. The invited person receives an email invitation to join your venue's operator account.",
          "If they're new to Happy Hour Compass, they can create their account directly from the invitation. If they already have an account, they can sign in with it to accept.",
          "Every invited team member gets the same standard access — there's no role to choose.",
        ],
        note: {
          heading: "Good to know",
          text: "If your account has reached its plan's user allowance, Invite User is unavailable until a slot frees up or you change your plan. Select Change your plan from Plan Usage to see your options.",
        },
      },
      {
        title: "Manage a pending invitation",
        body: [
          "Invitations that haven't been accepted yet appear under Pending Invitations, and count toward your plan's user allowance until they're accepted or cancelled.",
          "If you no longer need an invitation, select Cancel next to it and confirm. Cancelling removes it from the list and frees up the user slot right away.",
        ],
      },
      {
        title: "Remove a team member",
        body: [
          "Everyone with active access to your operator account appears under Active Users.",
          "To remove a team member, select Remove next to their name and confirm. Removing them ends their access immediately, and the freed user slot becomes available right away.",
        ],
        note: {
          heading: "Good to know",
          text: "The Admin doesn't have a Remove option next to their own name — this page can't be used to remove the Admin.",
        },
      },
    ],
    closingSection: {
      heading: "Keep your team access current",
      body: [
        "Review Users whenever your team changes — invite people as you bring them on, and remove access when someone no longer needs it.",
      ],
    },
    relatedSlugs: ["understand-subscriptions-and-limits"],
  },
  {
    type: "how-to",
    slug: "understand-analytics",
    title: "Understand analytics",
    summary:
      "Analytics helps you understand how consumers are discovering and interacting with your venue on Happy Hour Compass. Most of what you see reflects the last 30 days.",
    category: "Managing Your Venue",
    steps: [
      {
        title: "Understand your visibility",
        body: [
          "From Operator Admin, select Analytics from the main menu. Visibility shows how often consumers are seeing your venue, last 30 days.",
        ],
        items: [
          {
            heading: "Venue Views",
            text: "How many times consumers opened your venue page, regardless of how they found it.",
          },
          {
            heading: "Event Views",
            text: "How many times consumers opened your event pages.",
          },
          {
            heading: "Discover Impressions",
            text: "How often your venue appeared in the curated rails on the Happy Hour Compass home screen.",
          },
          {
            heading: "Discover Clicks",
            text: "How many times consumers selected your venue from one of those home-screen rails.",
          },
        ],
        note: {
          heading: "Good to know",
          text: "A new or lower-traffic venue may show zeros for a while, or \"—\" for ranking-style metrics like Most Viewed Event until there's enough activity to rank. That's expected, not a problem — the numbers update automatically as consumers find your venue.",
        },
        screenshot: {
          src: "/help/screenshots/analytics-overview.png",
          alt: "Analytics page showing the current plan and analytics tier, the Visibility section with Venue Views and Event Views alongside locked Discover Impressions and Discover Clicks, and the start of the Engagement section.",
          width: 819,
          height: 738,
        },
      },
      {
        title: "See how consumers engage",
        body: [
          "Engagement shows how consumers are interacting with your venue and events, last 30 days.",
        ],
        items: [
          {
            heading: "Saves",
            text: "How many times consumers saved your venue. This can be a sign they want to find it again later.",
          },
          {
            heading: "Most Viewed Event",
            text: "The event that received the most views in the last 30 days, helping you see which event is attracting the most attention.",
          },
          {
            heading: "Top Search Tag",
            text: "The search tag on your venue that consumers selected most often, in the last 30 days, while filtering their search — a sign of which characteristic is helping people find you.",
          },
        ],
      },
      {
        title: "Understand customer intent",
        body: [
          "Intent shows actions consumers take when they're interested, last 30 days — each one is a deliberate extra step after finding your venue.",
        ],
        items: [
          {
            heading: "Website Clicks",
            text: "How many times consumers selected the link to your website.",
          },
          {
            heading: "Menu Clicks",
            text: "How many times consumers selected the link to your menu.",
          },
          {
            heading: "Happy Hour Schedule Expands",
            text: "How many times consumers opened your full Happy Hour schedule.",
          },
          {
            heading: "Business Hours Expands",
            text: "How many times consumers opened your full business hours.",
          },
        ],
        screenshot: {
          src: "/help/screenshots/analytics-intent.png",
          alt: "Engagement section showing Saves, Most Viewed Event, and a locked Top Search Tag, followed by the Intent section showing Website Clicks, Menu Clicks, Happy Hour Schedule Expands, and Business Hours Expands.",
          width: 745,
          height: 790,
        },
      },
      {
        title: "Get more analytics with your plan",
        body: [
          "The analytics available to your venue depend on your subscription plan. Your current plan and analytics tier are shown at the top of the page — for example, Free plan — Basic Analytics.",
          "A metric your plan doesn't include yet appears locked, with a lock icon and a label naming the plan it's part of, like Premium feature or Pro feature. Discover Impressions and Discover Clicks are part of Premium, and Top Search Tag is included from Pro.",
          "Select Upgrade to Pro or Upgrade to Premium next to a locked metric, or visit Subscription to compare plans and change your plan.",
        ],
      },
    ],
    closingSection: {
      heading: "Check back regularly",
      body: [
        "Analytics updates automatically as consumers find and interact with your venue, so revisit it regularly to see how your visibility and engagement are trending.",
      ],
    },
    relatedSlugs: ["understand-subscriptions-and-limits"],
  },
  {
    type: "how-to",
    slug: "manage-search-tags",
    title: "Manage your Search Tags",
    summary:
      "Search tags describe real characteristics of your venue — like Patio or Live Music — so Happy Hour Compass can help match your venue with consumers looking for exactly that. Search tags are included on Pro and Premium.",
    category: "Managing Your Venue",
    steps: [
      {
        title: "Understand how Search Tags help your venue",
        body: [
          "Search tags describe real characteristics of your venue — like Patio, Wings, or Craft Beer — chosen from a fixed list built into Happy Hour Compass.",
          "When a consumer filters their search by a tag, or types something like \"patio\" or \"wings\" into the search box, venues with a matching tag are included in what they see — even if that word doesn't appear anywhere else in your listing.",
          "Search tags affect which venues match a search or filter — they don't affect how high your venue ranks in the results. So the goal isn't to select as many tags as possible, it's to choose the ones that genuinely describe your venue, so the consumers who find you are looking for what you actually offer.",
          "Like the rest of your listing, tags only apply once your venue is published.",
        ],
      },
      {
        title: "Choose your Search Tags",
        body: [
          "From Operator Admin, select Venue from the main menu, then open Search tags. Search tags are included on Pro and Premium — if your plan doesn't include them yet, you'll see a locked preview like the one below, with a few example tags and the option to change your plan.",
          "On a plan that includes search tags, select any tag from the list to add it — selected tags fill in amber. Select a tag again to remove it.",
          "Your current usage is shown as a running count against your plan's allowance. Once you reach it, remaining tags gray out until you remove one to make room — a higher plan can provide room for more, if you need it.",
          "Select Save tags to save your changes.",
        ],
        note: {
          heading: "Tip",
          text: "Choose the tags that genuinely describe your venue, rather than selecting every option available to you — accurate tags help match your venue with consumers who are actually looking for what you offer.",
        },
        screenshot: {
          src: "/help/screenshots/search-tags-selection.png",
          alt: "Search tags section of the Venue page shown on the Free plan, with example tags and a prompt to change your plan.",
          width: 681,
          height: 356,
        },
      },
      {
        title: "See which tags are getting attention",
        body: [
          "Once you've added tags, Analytics can show you which ones are getting attention. Top Search Tag shows which of your venue's configured tags consumers selected most often while filtering their search, in the last 30 days.",
          "It's specifically about tag filtering — not free-text searches, clicks on your venue, or how you rank in results. Top Search Tag is included from Pro.",
          "If you haven't configured any tags yet, or there's no matching activity yet, Top Search Tag has nothing to show. See Understand analytics for the full picture of what Analytics tracks.",
        ],
      },
    ],
    closingSection: {
      heading: "Keep your tags accurate",
      body: [
        "As your venue changes — a new patio, a new regular event, a different vibe — revisit Search tags so they still describe what makes your venue worth visiting.",
      ],
    },
    relatedSlugs: ["understand-subscriptions-and-limits", "understand-analytics"],
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
