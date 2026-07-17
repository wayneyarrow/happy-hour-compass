/**
 * Page-specific About page AboutPage JSON-LD (Structured Data — AboutPage
 * task; see docs/website/ structured data strategy/architecture reviews).
 *
 * Represents the /about page itself as a page — not Happy Hour Compass as
 * an entity (the sitewide Organization node already does that, referenced
 * here by @id only via `about`) and not a Person (the page intentionally
 * never names its founder — see below).
 *
 * Two properties this task asked to consider carefully are handled by
 * simply never being written into this file at all, not by a conditional
 * that always evaluates to "omit" — worth stating why plainly:
 *
 *   - primaryImageOfPage: the About page (src/app/(website)/about/page.tsx)
 *     contains exactly one <Image> (about-us-hh-sign.jpg), and it
 *     illustrates one narrative section ("It started with one simple
 *     question"), not a hero/cover image — the page's own hero section at
 *     the top has no image at all. The page's static `metadata` export
 *     also sets no openGraph.images, so nothing in the page or its
 *     metadata explicitly designates any asset as "the About page's
 *     image." Using the one editorial image anyway would be exactly the
 *     "first image because it appears first in source order" anti-pattern
 *     this task rules out — so there is nothing here to conditionally
 *     include.
 *   - Person / founder: the page is explicitly, deliberately anonymous by
 *     editorial design (see about/page.tsx's own doc comment: "no founder
 *     photo, team bios, or headshots," the founder narrated only in third
 *     person / singular "they," "deliberately never named, no photo, no
 *     dates"). No Person node, no founder/author/creator property, and no
 *     name is inferred from anywhere else (repo history, commit authors,
 *     account identity) to fill that intentional gap.
 */

import { absoluteUrl } from "@/lib/siteUrl";
import { entityId, organizationId, websiteId } from "./ids";
import type { SchemaNode, SchemaRef } from "./types";

export type AboutPageInput = {
  /** The page's canonical path — always "/about" (a fixed, unparameterized route with no redirects), passed in rather than hardcoded here to keep this module agnostic of the specific route. */
  canonicalPath: string;
  /**
   * The About page's approved public name. Sourced from the page's static
   * metadata title ("About Us"), not the visible <h1> ("Great local
   * experiences shouldn't be hard to find.") — that headline is
   * deliberately editorial/narrative copy (per the page's own doc
   * comment, a "magazine-style narrative" opening hook), not a page-name
   * label, so it doesn't "cleanly represent the page" the way a
   * structured `name` field should. The metadata title does.
   */
  name: string;
  /** The About page's approved public description — the same text already serialized in its <meta name="description"> tag. */
  description: string | null;
};

/**
 * Builds the page-specific AboutPage node, or null when the minimum
 * required identity can't be established — no canonical path, or no
 * non-empty public name. isPartOf/publisher/about are always included
 * once identity is established (they're fixed @id references, never
 * derived from potentially-missing data); description is the only
 * property that disappears cleanly when its source is absent.
 */
export function buildAboutPageNode(input: AboutPageInput): SchemaNode | null {
  if (!input.canonicalPath) return null;

  const name = input.name.trim();
  if (!name) return null;

  const url = absoluteUrl(input.canonicalPath);
  const isPartOf: SchemaRef = { "@id": websiteId() };
  const publisher: SchemaRef = { "@id": organizationId() };
  const about: SchemaRef = { "@id": organizationId() };
  const description = input.description?.trim() || undefined;

  return {
    "@type": "AboutPage",
    "@id": entityId(input.canonicalPath, "aboutpage"),
    name,
    url,
    isPartOf,
    publisher,
    about,
    ...(description && { description }),
  };
}
