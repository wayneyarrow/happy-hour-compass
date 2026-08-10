import type { HowToArticle } from "./types";

/**
 * Standard How-To Article registry — Operator Admin Help Center, V1.
 *
 * This is the entire content model for How-To articles: a plain array of
 * data objects rendered through the single shared route at
 * src/app/admin/help/[slug]/page.tsx. Adding a real article later means
 * appending an object here — no new page, no new routing logic.
 *
 * IMPORTANT: the two entries below are placeholders that exist only to
 * prove the renderer, optional-section behavior, screenshot presentation,
 * and related-article linking work end-to-end. They are marked
 * `isPlaceholder: true` (rendered with a visible "Internal preview" badge)
 * and must not be treated as approved Help Center content. The real article
 * inventory will be produced in a follow-up task after Operator Admin is
 * reviewed — replace/remove these once real articles land.
 */
export const HOW_TO_ARTICLES: HowToArticle[] = [
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
