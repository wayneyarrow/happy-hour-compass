import type { HowToArticle } from "./types";

/**
 * Standard How-To Article registry — Operator Admin Help Center, V1.
 *
 * This is the entire content model for How-To articles: a plain array of
 * data objects rendered through the single shared route at
 * src/app/admin/help/[slug]/page.tsx. Adding a real article later means
 * appending an object here — no new page, no new routing logic.
 *
 * "Manage your venue information" (below) is the first real, approved
 * How-To article, following the design/content standard established by the
 * Getting Started guides. It's listed first so it displays above the
 * Internal Preview category on the landing page. The two Internal Preview
 * entries after it are placeholders that exist only to prove the renderer,
 * optional-section behavior, screenshot presentation, and related-article
 * linking work end-to-end. They are marked `isPlaceholder: true` (rendered
 * with a visible "Internal preview" badge) and must not be treated as
 * approved Help Center content — kept for now per the task brief, to be
 * removed once enough real articles exist.
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
