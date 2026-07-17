/**
 * Page-specific guide Article JSON-LD (Structured Data — Article task; see
 * docs/website/ structured data strategy/architecture reviews).
 *
 * Represents a published Content Engine guide (venue_guide or event_guide —
 * see src/lib/data/contentGuides.ts) as a plain Article, published by the
 * Happy Hour Compass Organization (referenced by @id only — see
 * organizationId(), never embedded). Article, not BlogPosting or
 * NewsArticle: the Content Engine is explicitly "not a traditional CMS or
 * blogging platform" (CONTENT_ENGINE_PRODUCT_SPEC.md), and nothing here
 * behaves like time-sensitive news reporting either.
 *
 * Two properties this task asked to consider carefully are omitted
 * entirely, not just conditionally — worth stating why plainly:
 *
 *   - author: content_guides has no author/byline column anywhere, and no
 *     guide page renders an author identity publicly (confirmed by
 *     inspecting GUIDE_DETAIL_COLUMNS and PublicGuideDetail — neither
 *     includes anything author-shaped). There is nothing here to
 *     represent, and no name (a founder, "Happy Hour Compass Team", etc.)
 *     is invented to fill the gap.
 *   - articleBody / text / wordCount / keywords / about / mentions: not
 *     requested by the current Structured Data Strategy, and copying full
 *     guide content into JSON-LD is explicitly out of scope.
 */

import { absoluteUrl } from "@/lib/siteUrl";
import { entityId, organizationId } from "./ids";
import { toSchemaImage } from "./image";
import type { SchemaNode, SchemaRef } from "./types";

export type GuideArticleInput = {
  /**
   * The guide's final resolved canonical path — the exact same value the
   * guide page's own generateMetadata() resolves for its
   * <link rel="canonical"> tag (manual content_guides.canonical_url
   * override when it looks like a path, else generateGuideSeo()'s
   * generated canonical_url). Passed in already-resolved rather than
   * recomputed here so this module never needs its own copy of that
   * cascade — see the guide page's own call site for where it's built.
   */
  canonicalPath: string;
  /** The guide's public title (content_guides.title), used verbatim as headline — never shortened or rewritten here. */
  headline: string;
  /**
   * The guide's stored meta_description column. GuideForm auto-fills this
   * from generateGuideSeo() as the admin types (client-side, "until the
   * admin edits that field") and actions.ts persists whatever ends up in
   * the form at submit time — so for any guide actually published through
   * the normal editorial flow, this is already the same resolved
   * description text the <meta name="description"> tag serves, not a
   * separately-invented value. Only genuinely blank (never submitted
   * through the form, or explicitly cleared) when there is truly no
   * reliable description to use.
   */
  description: string | null;
  /** content_guides.hero_image_url — the same field the guide page's own OG image falls back to. */
  heroImageUrl: string | null;
  /**
   * content_guides.publish_at — the scheduling field isGuidePublicNow()
   * gates public visibility on. When present (and, since this input only
   * ever describes an already-public guide, necessarily <= now), it is a
   * reliable "this guide became public at this moment" fact. When null,
   * the guide was published immediately with no scheduling, and nothing
   * in the data model separately records the actual first-published
   * moment — content_guides.created_at isn't even selected by the guide's
   * own public read query, and using it would risk predating actual
   * publication for a guide that sat in draft status first (exactly what
   * this task warned against). datePublished is omitted in that case
   * rather than backfilled from anything else.
   */
  publishAt: string | null;
  /**
   * content_guides.updated_at — the same column src/app/sitemap.ts already
   * trusts as this exact guide URL's lastModified for public SEO purposes.
   * Scoped to the content_guides row itself (title/body/SEO fields/hero
   * image, etc.); guide attachments, FAQs, and distribution-channel
   * eligibility all live in separate tables and don't touch it, so it
   * isn't polluted by unrelated cross-table operations.
   */
  updatedAt: string;
};

/** Parses a stored timestamp to ISO 8601, or undefined if it isn't a valid date — never emits "Invalid Date". */
function toIsoDate(value: string | null): string | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/**
 * Builds the page-specific guide Article node, or null when the minimum
 * required identity can't be established — no canonical path, or no
 * non-empty public headline. Every optional property is included only
 * when its underlying value is present, non-empty, and (for dates) a
 * valid timestamp.
 */
export function buildGuideArticleNode(input: GuideArticleInput): SchemaNode | null {
  if (!input.canonicalPath) return null;

  const headline = input.headline.trim();
  if (!headline) return null;

  const url = absoluteUrl(input.canonicalPath);
  const publisher: SchemaRef = { "@id": organizationId() };
  const mainEntityOfPage: SchemaRef = { "@id": url };

  const description = input.description?.trim() || undefined;
  const image = toSchemaImage(input.heroImageUrl);
  const datePublished = toIsoDate(input.publishAt);
  const dateModified = toIsoDate(input.updatedAt);

  return {
    "@type": "Article",
    "@id": entityId(input.canonicalPath, "article"),
    headline,
    url,
    publisher,
    mainEntityOfPage,
    ...(description && { description }),
    ...(image && { image }),
    ...(datePublished && { datePublished }),
    ...(dateModified && { dateModified }),
  };
}
