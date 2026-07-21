/**
 * SEO metadata helpers — server-side only.
 *
 * Use buildPageMetadata() to generate consistent Next.js Metadata objects for
 * any public-facing page. All fields follow the same conventions so canonical
 * URLs, OG tags, and Twitter cards stay in sync automatically.
 *
 * Usage (in any page.tsx generateMetadata or static metadata export):
 *
 *   import { buildPageMetadata } from "@/lib/seo/metadata";
 *
 *   export const metadata = buildPageMetadata({
 *     title: "The Keg — Happy Hour in Vancouver",
 *     description: "Weekday happy hour at The Keg: $9 cocktails, half-price apps.",
 *     path: "/greater-vancouver/vancouver/the-keg-vancouver",
 *   });
 *
 * Phases and what to build next:
 *   Phase 1 (now):   title, description, canonical, OG, Twitter card — defaults only.
 *   Phase 2:         Per-page OG images via Next.js ImageResponse (/opengraph-image.tsx).
 *   Phase 3:         JSON-LD structured data helpers (LocalBusiness, Event, BreadcrumbList).
 *   Phase 4:         Per-market and per-category metadata templates.
 */

import type { Metadata } from "next";
import { absoluteUrl, shouldNoIndex } from "@/lib/siteUrl";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";

export interface PageMetadataOptions {
  /** Page title — used in <title>, OG title, Twitter title. Do NOT include " — Happy Hour Compass" suffix; the root layout template adds it. */
  title: string;
  /** Page description — used in meta description, OG description, Twitter description. 120–160 characters recommended. */
  description: string;
  /** Canonical path, e.g. "/greater-vancouver/vancouver/the-keg-vancouver". Defaults to "/". */
  path?: string;
  /**
   * OG image path or absolute URL.
   * Phase 1 default: DEFAULT_OG_IMAGE (see below) — a real, existing sitewide
   * brand asset, used whenever a caller has no page-specific image.
   * Phase 2: switch to dynamic ImageResponse via /opengraph-image.tsx routes.
   */
  ogImage?: string;
  /** Override OG type. Defaults to "website". Use "article" for guide/editorial pages. */
  ogType?: "website" | "article";
  /**
   * Overrides the Open Graph / Twitter title. Defaults to `title`. Lets a
   * caller keep a longer/branded `<title>` while giving social cards a
   * shorter, unbranded one (e.g. Content Engine guides, which store og_title
   * separately from page_title/meta_title).
   */
  ogTitle?: string;
  /** Overrides the Open Graph / Twitter description. Defaults to `description`. */
  ogDescription?: string;
  /**
   * Overrides the canonical + OG url path. Defaults to `path`. Lets a caller
   * honor an admin-entered canonical URL (e.g. a Content Engine guide's
   * `canonical_url` field) that may differ from the route's own path.
   */
  canonicalPath?: string;
}

/**
 * Sitewide fallback OG/Twitter image for any caller that has no
 * page-specific image of its own (e.g. a Collection landing page, which has
 * no image field at all, or an Event with no uploaded photo). Must always
 * point at a real file in /public — this previously pointed at
 * "/og-default.png", which was never actually added, producing a broken
 * image URL in every social preview that fell through to it (see the SEO
 * Metadata Consistency Audit). /logo.png is the existing asset this
 * codebase already treats as "the" standalone brand logo in every other
 * external-facing context — email templates, auth-flow pages, the
 * Organization JSON-LD node (src/lib/seo/schema/organization.ts), and the
 * Guide detail page's own hero-image fallback — so reusing it here keeps
 * one single fallback image sitewide instead of introducing a second,
 * OG-specific asset.
 */
const DEFAULT_OG_IMAGE = "/logo.png";
const SITE_NAME = "Happy Hour Compass";
const LOCALE = "en_CA";

export function buildPageMetadata({
  title,
  description,
  path = "/",
  ogImage = DEFAULT_OG_IMAGE,
  ogType = "website",
  ogTitle,
  ogDescription,
  canonicalPath,
}: PageMetadataOptions): Metadata {
  const canonicalUrl = absoluteUrl(canonicalPath ?? path);
  const imageUrl = ogImage.startsWith("http") ? ogImage : absoluteUrl(ogImage);
  const noindex = shouldNoIndex();
  const resolvedOgTitle = ogTitle ?? title;
  const resolvedOgDescription = ogDescription ?? description;

  return {
    title,
    description,
    ...(noindex && { robots: { index: false, follow: false } }),
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: resolvedOgTitle,
      description: resolvedOgDescription,
      url: canonicalUrl,
      siteName: SITE_NAME,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: resolvedOgTitle,
        },
      ],
      type: ogType,
      locale: LOCALE,
    },
    twitter: {
      card: "summary_large_image",
      title: resolvedOgTitle,
      description: resolvedOgDescription,
      images: [imageUrl],
    },
  };
}

/**
 * Venue page metadata builder — used by
 * (website)/[market]/[city]/[slug]/page.tsx's generateMetadata().
 *
 * Canonical path is /{marketSlug}/{citySlug}/{slug} — see
 * src/lib/publicVenueUrl.ts. Returns title/description only (no canonical/OG
 * image override) when the venue has no assigned market/city yet.
 *
 * Phase 2: wire in OG image from the venue's primary photo.
 * Phase 3: add LocalBusiness + FoodEstablishment JSON-LD via a separate helper.
 */
export function buildVenueMetadata({
  venueName,
  description,
  marketSlug,
  citySlug,
  slug,
  ogImage,
}: {
  venueName: string;
  description: string;
  marketSlug: string | null;
  citySlug: string | null;
  slug: string;
  ogImage?: string;
}): Metadata {
  const path = buildVenuePublicPath({ marketSlug, citySlug, slug });
  if (!path) {
    // No assigned market/city — no canonical public URL exists yet. Return
    // title/description only rather than letting buildPageMetadata's own
    // path default ("/") produce a canonical/OG url pointing at the
    // homepage, which would be wrong for a venue that isn't the homepage.
    return { title: venueName, description };
  }
  return buildPageMetadata({
    title: venueName,
    description,
    path,
    ogImage,
  });
}

/**
 * Event page metadata builder — used by both the canonical event route
 * ((website)/[market]/[city]/events/[slug]/page.tsx) and its UUID
 * compatibility route ((website)/website-events/[id]/page.tsx, which self-
 * canonicalizes only in the graceful-fallback case where an event's venue
 * has no resolvable market/city).
 *
 * Unlike buildVenueMetadata, this does NOT compute the path internally via
 * buildEventPublicPath() — the two callers need two different fallback
 * strategies (the canonical route falls back to the UUID path when
 * geography is unresolved; the compat route IS that UUID path), so each
 * caller resolves its own final `path` and passes it straight through.
 * `path: null` (event not found under this route's lookup) returns bare
 * title/description with no canonical/OG url, mirroring buildVenueMetadata.
 *
 * Phase 2: wire in OG image from the event/venue photo.
 * Phase 3: add Event JSON-LD via a separate helper.
 */
/**
 * Metadata for the shared "Coming Soon" experience
 * ((website)/MarketComingSoon.tsx) rendered in place of venue/event/
 * collection/guide content whose market isn't active (see
 * src/lib/markets.ts). Deliberately minimal — no canonical/OG override,
 * since a noindex page has nothing worth surfacing in search or social
 * previews — but always explicitly noindex so these pages are never indexed
 * regardless of environment (unlike buildPageMetadata's noindex, which only
 * triggers from shouldNoIndex() on staging). follow stays true so crawlers
 * can still reach the active-market link this page points visitors to.
 */
export function buildComingSoonMetadata(marketName: string): Metadata {
  return {
    title: `${marketName} — Coming Soon`,
    description: `${marketName} is coming soon to Happy Hour Compass.`,
    // follow: true (not false) — crawlers should still follow the page's
    // link back to the active Central Okanagan experience, even though the
    // page itself stays out of the index.
    robots: { index: false, follow: true },
  };
}

export function buildEventMetadata({
  eventName,
  description,
  path,
  ogImage,
}: {
  eventName: string;
  description: string;
  path: string | null;
  ogImage?: string;
}): Metadata {
  if (!path) return { title: eventName, description };
  return buildPageMetadata({
    title: eventName,
    description,
    path,
    ogImage,
  });
}
