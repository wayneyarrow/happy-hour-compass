/**
 * Sitewide Organization JSON-LD (Structured Data — Organization task; see
 * docs/website/ structured data strategy/architecture reviews).
 *
 * Represents Happy Hour Compass itself — a hospitality discovery platform,
 * and the publisher/operator of this website — never a listed venue, event
 * organizer, ticket seller, or reservation provider. This is the one
 * sitewide entity every page's structured data can reference by @id (see
 * organizationId()); it is rendered once, from (website)/layout.tsx, via
 * JsonLd — this module only builds the plain node.
 *
 * Deliberately minimal: only @type/@id/name/url/logo are included. Every
 * optional Organization property schema.org supports (legalName,
 * foundingDate, founder, address, telephone, email, sameAs, etc.) is
 * omitted because none of it is currently accurate/supportable from
 * approved project data — see the structured data strategy review's
 * Organization section (no public social profiles exist yet for sameAs;
 * the About page intentionally never names a founder; no public
 * address/phone is published anywhere on the site today). Add any of
 * these later only once real, approved data exists to back it — never
 * speculatively.
 */

import { absoluteUrl } from "@/lib/siteUrl";
import { organizationId } from "./ids";
import type { SchemaNode } from "./types";

const ORGANIZATION_NAME = "Happy Hour Compass";

/**
 * The canonical full-brand logo asset (public/logo.png) — square (1024x1024),
 * already the asset this codebase treats as "the" standalone brand logo in
 * every other external-facing context: email templates (src/lib/email.ts),
 * auth-flow pages, and the guide page's own OG-image fallback. hhc-icon.png
 * was not used here — it plays the browser-tab-favicon/small-mark role
 * elsewhere in the app (src/app/layout.tsx's `icons`, WebsiteFooter's dark-
 * surface mark) and is not square (271x345), which is a worse fit for
 * Google's square-logo guidance than logo.png's 1024x1024.
 */
const LOGO_PATH = "/logo.png";

export type OrganizationNode = SchemaNode & {
  "@type": "Organization";
  "@id": string;
  name: string;
  url: string;
  logo: string;
};

/**
 * Builds the sitewide Organization node. Pure and parameterless — every
 * field is a fixed site constant, not derived from any page-specific or
 * database-sourced input.
 *
 * Resolves the logo via absoluteUrl() directly rather than the shared
 * toSchemaImage() helper: toSchemaImage() exists to handle possibly-null
 * per-row image fields (venue/event/guide images), which isn't the
 * situation here — LOGO_PATH is a compile-time-known, always-relative,
 * never-empty asset path, so calling absoluteUrl() directly returns a
 * plain `string` with no null-handling to route around.
 */
export function buildOrganizationNode(): OrganizationNode {
  return {
    "@type": "Organization",
    "@id": organizationId(),
    name: ORGANIZATION_NAME,
    url: absoluteUrl("/"),
    logo: absoluteUrl(LOGO_PATH),
  };
}
