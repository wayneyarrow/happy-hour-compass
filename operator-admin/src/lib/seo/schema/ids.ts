/**
 * Stable @id helpers for JSON-LD nodes.
 *
 * @id values are always derived from a page's canonical URL via
 * absoluteUrl() (src/lib/siteUrl.ts) — never from a database UUID. This
 * means a venue/event/guide/collection's identity in structured data moves
 * automatically with its canonical URL (including the existing
 * permanentRedirect-on-mismatch and venue_slug_history handling on the
 * venue page), instead of needing a second, independently-maintained
 * identity system.
 *
 * organizationId()/websiteId() are fixed, sitewide anchors — identical on
 * every page, never derived from a page-specific path. Per-entity id
 * builders (venue, event, article, collection) are deliberately not added
 * here yet — each is a trivial entityId() call the corresponding schema
 * builder will make once it exists, and adding them now would mean
 * guessing at fragment names ahead of the builders that actually decide
 * them.
 */

import { absoluteUrl } from "@/lib/siteUrl";

/** Builds a stable @id by anchoring a URL fragment to a canonical path. */
export function entityId(canonicalPath: string, fragment: string): string {
  return `${absoluteUrl(canonicalPath)}#${fragment}`;
}

/** The one, sitewide Organization node's @id — identical on every page. */
export function organizationId(): string {
  return entityId("/", "organization");
}

/** The one, sitewide WebSite node's @id — identical on every page. */
export function websiteId(): string {
  return entityId("/", "website");
}
