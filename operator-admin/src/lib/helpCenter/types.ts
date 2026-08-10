/**
 * Help Center content model — Operator Admin.
 *
 * V1 supports exactly two article types (see docs discussion / task brief):
 *   1. Getting Started / Onboarding Guide — see gettingStartedContent.ts.
 *      Its content varies by operator/venue origin, so it is modeled
 *      separately rather than as a HowToArticle.
 *   2. Standard How-To Article — modeled by HowToArticle below.
 *
 * Articles are plain data (no CMS, no MDX). Adding a new article is a matter
 * of appending an object to the registry in articles.ts — no new route or
 * bespoke React page is required. See articles.ts for the registry and
 * articleUrl()/isValidArticleSlug() for routing helpers.
 */

/** A single screenshot associated with an article or a step within one. */
export type HelpScreenshot = {
  /** Path under /public, e.g. "/help/screenshots/venue-hours.png". */
  src: string;
  /** Required — describes what the screenshot shows, not just "screenshot". */
  alt: string;
  width: number;
  height: number;
};

/** One numbered procedural step. Screenshot is optional per-step. */
export type HelpStep = {
  title: string;
  /** One or more short paragraphs. Kept as an array so a step can include
   *  a brief lead-in plus a clarifying note without smuggling markup into a
   *  single string. */
  body: string[];
  screenshot?: HelpScreenshot;
};

export type HowToArticle = {
  type: "how-to";
  /** URL segment — /admin/help/[slug]. Lowercase, hyphenated, no DB ids. */
  slug: string;
  title: string;
  /** One-sentence outcome/introduction. */
  summary: string;
  /** Lightweight grouping label for landing-page navigation only — not part
   *  of the URL. V1 keeps this optional and unopinionated; the real category
   *  taxonomy is deferred to a future task per the project brief. */
  category?: string;
  /** Optional — only rendered when present and non-empty. */
  beforeYouStart?: string[];
  steps: HelpStep[];
  /** Optional — only rendered when present. */
  whatHappensNext?: string;
  /** Optional — only rendered when present and non-empty. */
  goodToKnow?: string[];
  /** Slugs of related articles. Cap of 3 enforced by getRelatedArticles(). */
  relatedSlugs?: string[];
  /**
   * Marks content that exists only to prove the renderer/architecture works
   * (per task brief) and has not gone through the real Help Center content
   * review process. Rendered with a visible "Internal preview" badge so it
   * can never be mistaken for approved content. Should be false/omitted for
   * every real article added after this task.
   */
  isPlaceholder?: boolean;
};
