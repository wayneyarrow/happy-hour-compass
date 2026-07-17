/**
 * Sitewide WebSite JSON-LD (Structured Data — WebSite task; see
 * docs/website/ structured data strategy/architecture reviews).
 *
 * Represents the Happy Hour Compass website as a WebSite entity, published
 * by the Organization (see organization.ts) — referenced here by @id only,
 * never duplicated or re-embedded. Rendered once, from
 * (website)/layout.tsx, in the same shared JsonLd graph as the Organization
 * node; this module only builds the plain node.
 *
 * Deliberately minimal: only @type/@id/name/url/publisher are included.
 * SearchAction (`potentialAction`) is intentionally omitted — Happy Hour
 * Compass does not yet have a stable, crawlable search-results URL contract
 * suitable for structured-data markup (see the structured data strategy
 * review's Search section). No search URL template, query parameter, or
 * SearchAction target should be invented here; this stays deferred until a
 * real, indexable search-results URL exists as a deliberate product
 * decision — not something a schema builder should get ahead of.
 */

import { absoluteUrl } from "@/lib/siteUrl";
import { organizationId, websiteId } from "./ids";
import type { SchemaNode, SchemaRef } from "./types";

const WEBSITE_NAME = "Happy Hour Compass";

export type WebSiteNode = SchemaNode & {
  "@type": "WebSite";
  "@id": string;
  name: string;
  url: string;
  publisher: SchemaRef;
};

/**
 * Builds the sitewide WebSite node. Pure and parameterless — every field is
 * a fixed site constant, not derived from any page-specific or
 * database-sourced input. `publisher` is an @id-only reference to the
 * Organization node (see organization.ts) rather than an embedded copy —
 * both nodes are rendered together in the same document graph, so the
 * reference resolves within that same page's JSON-LD.
 */
export function buildWebSiteNode(): WebSiteNode {
  return {
    "@type": "WebSite",
    "@id": websiteId(),
    name: WEBSITE_NAME,
    url: absoluteUrl("/"),
    publisher: { "@id": organizationId() },
  };
}
