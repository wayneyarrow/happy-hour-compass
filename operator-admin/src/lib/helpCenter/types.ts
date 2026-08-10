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
  /** One or more short paragraphs, rendered before `list`. Kept as an array
   *  so a step can include a brief lead-in plus a clarifying note without
   *  smuggling markup into a single string. */
  body: string[];
  /** Optional bullet list rendered after `body` (e.g. the specific fields a
   *  step asks the operator to review). */
  list?: string[];
  /** Optional paragraphs rendered after `list` — for a step whose
   *  instructions continue past the bullet list. */
  afterList?: string[];
  /** Optional labeled callout rendered near the end of the step, after
   *  `body`/`list`/`afterList` (e.g. a step-scoped "Good to know" note, as
   *  distinct from the article-level one rendered by HelpInfoSection). The
   *  `heading` is free text, not fixed to "Good to know" — e.g. a
   *  "Tip: ..." heading gets the identical treatment for a product tip
   *  that deserves the same visual prominence. `screenshot` is optional and
   *  only needed when a step must show two screenshots (its own, plus one
   *  illustrating the tip) — mirrors HelpSection's body+screenshot pattern
   *  rather than introducing a new component. */
  note?: { heading: string; text: string; screenshot?: HelpScreenshot };
  screenshot?: HelpScreenshot;
};

/** An unnumbered content block — used for lead-in / closing sections that
 *  fall outside the numbered step sequence (e.g. Getting Started's intro
 *  dashboard section, or a closing wrap-up section). Shares HelpStep's
 *  typography so both read as one system; rendered via HelpSection.tsx. */
export type HelpSection = {
  heading: string;
  body: string[];
  /** Optional short emphasized lead-in line rendered directly above `list`
   *  (e.g. "It helps you:"). */
  listIntro?: string;
  /** Optional bullet list rendered after `body`/`listIntro`. */
  list?: string[];
  /** Optional paragraphs rendered after `list`. */
  afterList?: string[];
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
  /** Optional unnumbered wrap-up section rendered after the steps (e.g. a
   *  "Keep your information current" close), reusing the same HelpSection
   *  established by the Getting Started guides for their closing section. */
  closingSection?: HelpSection;
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
