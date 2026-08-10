import type { HowToArticle } from "./types";

/**
 * Standard How-To Article registry — Operator Admin Help Center, V1.
 *
 * This is the entire content model for How-To articles: a plain array of
 * data objects rendered through the single shared route at
 * src/app/admin/help/[slug]/page.tsx. Adding a real article later means
 * appending an object here — no new page, no new routing logic.
 *
 * "Manage your venue information", "Manage your venue images", and "Publish
 * or unpublish your venue" (below) are the real, approved How-To articles,
 * following the design/content standard established by the Getting Started
 * guides. They're listed first, under the "Managing Your Venue" category, so
 * they display above the Internal Preview category on the landing page. The
 * two Internal Preview entries after them are placeholders that exist only
 * to prove the renderer, optional-section behavior, screenshot presentation,
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
