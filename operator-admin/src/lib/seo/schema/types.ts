/**
 * Shared JSON-LD primitives for structured data (Structured Data
 * Architecture — see docs/website/ structured data strategy/architecture
 * reviews). Every schema builder (Organization, WebSite, venue, event,
 * article, collection, AboutPage, breadcrumbs — each its own future task)
 * returns SchemaNode | null against these shapes. Builders never include
 * "@context" or wrap themselves in "@graph" — that envelope is owned
 * entirely by the JsonLd render component
 * (src/app/(website)/JsonLd.tsx), so a builder's output can be embedded in
 * either the sitewide graph or a page-specific graph without change.
 */

/** A minimal schema.org node. Builders type their return value against a narrower shape that extends this. */
export type SchemaNode = Record<string, unknown> & {
  "@type": string;
  "@id"?: string;
};

/** A reference to a node defined elsewhere in the same page's JSON-LD (see JsonLd.tsx doc comment for why this only resolves within one page). */
export type SchemaRef = { "@id": string };

/** The full envelope a <script type="application/ld+json"> tag ultimately contains. Only JsonLd.tsx constructs this — builders and callers never do. */
export type SchemaGraph = {
  "@context": "https://schema.org";
  "@graph": SchemaNode[];
};
