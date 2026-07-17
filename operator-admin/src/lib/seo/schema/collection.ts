/**
 * Page-specific collection CollectionPage JSON-LD (Structured Data —
 * CollectionPage task; see docs/website/ structured data strategy/
 * architecture reviews and HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md).
 *
 * Represents the Collection Landing Page itself
 * (/{market}/collections/{slug}) — the page's identity, not the venues,
 * events, or guides it happens to display on a given request. Published
 * by the Happy Hour Compass Organization (@id-only reference — see
 * organizationId(), never embedded) and part of the sitewide WebSite
 * (@id-only reference — see websiteId(), never embedded).
 *
 * Two properties this task asked to consider carefully are omitted
 * entirely, not just conditionally — worth stating why plainly:
 *
 *   - mainEntity (and, per the task, ItemList/numberOfItems/
 *     itemListElement under any name): Collection membership is resolved
 *     dynamically, per request, by resolveCollectionPreview() —
 *     algorithmic ranking plus manual include/exclude/boost overrides
 *     (see collectionPublic.ts's getPublicCollectionModel and
 *     HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md's "Collections own: Membership,
 *     Algorithm, Manual Boosts, Include, Exclude, Ordering"). The set of
 *     items a visitor sees can change between one request and the next as
 *     content is published/unpublished or rankings shift. Serializing
 *     "whatever happened to be resolved this request" as a permanent
 *     mainEntity/ItemList would assert a fixed list the data model
 *     explicitly does not guarantee — precisely the failure mode this
 *     task's "Dynamic and personalized collections" section warns against.
 *   - image: PublicCollectionModel / CollectionDetail (collectionsShared.ts)
 *     has no image field at all — no hero image, no representative image,
 *     nothing collection-specific. The collection landing page's own
 *     generateMetadata() confirms this: it never passes an ogImage to
 *     buildPageMetadata(), so even the page's own OG tag falls through to
 *     the sitewide generic default, not a collection-specific asset. There
 *     is nothing here to conditionally include — using a card image, a
 *     stock fallback, or the HHC logo instead would be exactly the
 *     "asset not explicitly treated as the collection's approved public
 *     image" this task rules out.
 */

import { absoluteUrl } from "@/lib/siteUrl";
import { entityId, organizationId, websiteId } from "./ids";
import type { SchemaNode, SchemaRef } from "./types";

export type CollectionPageInput = {
  /**
   * The collection landing page's canonical path — the same
   * `/${marketSlug}/collections/${slug}` template the page's own
   * generateMetadata() builds inline for its <link rel="canonical"> tag.
   * Collections have no admin-editable canonical override field (unlike
   * guides' canonical_url), so this is a direct template, not a cascade —
   * passed in already-resolved so this module doesn't need its own copy
   * of the construction.
   */
  canonicalPath: string;
  /** The collection's public name (CollectionDetail.name / PublicCollectionModel.name) — the same heading the landing page renders and generateMetadata() uses as the page title. */
  name: string;
  /**
   * PublicCollectionModel.publicIntro — the one field
   * collectionsShared.ts's own doc comment describes as "visitor-facing
   * copy," explicitly distinct from the internal-only `description`
   * field (which is never exposed publicly, by design). Deliberately NOT
   * falling back to generateCollectionFallbackDescription() the way the
   * page's own generateMetadata() does for its <meta name="description">
   * tag: that fallback is a template-generated sentence computed fresh on
   * every render with no editorial review step, not approved public copy
   * an editor wrote or accepted — a meaningfully different bar than
   * publicIntro, and the more conservative one this task sets for JSON-LD
   * specifically ("do not generate new copy inside the schema builder").
   */
  publicIntro: string | null;
};

/**
 * Builds the page-specific CollectionPage node, or null when the minimum
 * required identity can't be established — no canonical path, or no
 * non-empty public name. isPartOf/publisher are always included once
 * identity is established (they're fixed @id references, never derived
 * from potentially-missing data); description is the only property that
 * disappears cleanly when its source is absent.
 */
export function buildCollectionPageNode(input: CollectionPageInput): SchemaNode | null {
  if (!input.canonicalPath) return null;

  const name = input.name.trim();
  if (!name) return null;

  const url = absoluteUrl(input.canonicalPath);
  const isPartOf: SchemaRef = { "@id": websiteId() };
  const publisher: SchemaRef = { "@id": organizationId() };
  const description = input.publicIntro?.trim() || undefined;

  return {
    "@type": "CollectionPage",
    "@id": entityId(input.canonicalPath, "collectionpage"),
    name,
    url,
    isPartOf,
    publisher,
    ...(description && { description }),
  };
}
