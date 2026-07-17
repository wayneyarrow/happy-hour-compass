/**
 * Shared BreadcrumbList JSON-LD builder (Structured Data — BreadcrumbList
 * task; see docs/website/ structured data strategy/architecture reviews).
 *
 * A single, route-agnostic builder — it has no idea what a venue, guide,
 * or collection is. Every page-specific route file is responsible for
 * deciding its own real breadcrumb hierarchy (which levels genuinely
 * exist as canonical public routes, what each level is called) and
 * passing already-resolved { name, path } items in; this module only
 * validates, sequences, and serializes them. See each page's own call
 * site for the route-specific investigation behind its chosen items.
 *
 * Governing rule carried over from every other builder in this
 * directory: never mark up a fact — here, a navigational relationship —
 * this data model/route map cannot stand behind. A breadcrumb level is
 * only ever included by a caller when a real, canonical, indexable route
 * backs it; this builder has no opinion on that beyond rejecting
 * obviously-empty input.
 */

import { absoluteUrl } from "@/lib/siteUrl";
import { entityId } from "./ids";
import type { SchemaNode } from "./types";

export type BreadcrumbItemInput = {
  /** The item's public label — trimmed, never title-cased or derived from a slug. */
  name: string;
  /** A root-relative canonical path ("/about") or an absolute URL. Resolved to absolute via absoluteUrl() when relative. */
  path: string;
};

export type BreadcrumbListInput = {
  /** The current page's own canonical path — anchors this BreadcrumbList's own @id, independent of the individual item URLs. */
  canonicalPath: string;
  /** Items in display order, position 1 first (Home). */
  items: BreadcrumbItemInput[];
};

/**
 * Builds a BreadcrumbList node, or null when fewer than two valid items
 * remain after validation — a single-item "breadcrumb" (just the current
 * page) asserts no real navigational relationship and is never emitted.
 *
 * Validation/omission rules:
 *   - Both canonicalPath and each item's name/path must be non-empty
 *     after trimming; an item failing either check is dropped entirely
 *     (not replaced with a placeholder).
 *   - Names are trimmed; never title-cased, slug-derived, or rewritten.
 *   - Positions are assigned sequentially (1, 2, 3, ...) after invalid
 *     items are dropped — a dropped item never leaves a gap in the
 *     sequence.
 *   - Consecutive items resolving to the identical absolute URL are
 *     deduplicated (only the first is kept) — the smallest predictable
 *     behavior for a caller that accidentally repeats a level, chosen
 *     over silently keeping a redundant hop or rejecting the whole list.
 *   - Every item's `item` URL is included, including the final (current
 *     page) item — schema.org/Google treat this as optional on the last
 *     item, but one consistent convention across every page type is
 *     simpler and not incorrect to include.
 */
export function buildBreadcrumbListNode(input: BreadcrumbListInput): SchemaNode | null {
  if (!input.canonicalPath) return null;

  const resolved: { name: string; url: string }[] = [];

  for (const rawItem of input.items) {
    const name = rawItem.name.trim();
    if (!name) continue;
    if (!rawItem.path) continue;

    const url = rawItem.path.startsWith("http") ? rawItem.path : absoluteUrl(rawItem.path);

    const previous = resolved[resolved.length - 1];
    if (previous && previous.url === url) continue;

    resolved.push({ name, url });
  }

  if (resolved.length < 2) return null;

  return {
    "@type": "BreadcrumbList",
    "@id": entityId(input.canonicalPath, "breadcrumb"),
    itemListElement: resolved.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
