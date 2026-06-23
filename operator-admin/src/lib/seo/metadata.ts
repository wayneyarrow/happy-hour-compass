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
 *     path: "/venue/vancouver-the-keg",
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

export interface PageMetadataOptions {
  /** Page title — used in <title>, OG title, Twitter title. Do NOT include " — Happy Hour Compass" suffix; the root layout template adds it. */
  title: string;
  /** Page description — used in meta description, OG description, Twitter description. 120–160 characters recommended. */
  description: string;
  /** Canonical path, e.g. "/venue/the-keg-vancouver". Defaults to "/". */
  path?: string;
  /**
   * OG image path or absolute URL.
   * Phase 1 default: /og-default.png (static asset — add this file before launch).
   * Phase 2: switch to dynamic ImageResponse via /opengraph-image.tsx routes.
   */
  ogImage?: string;
  /** Override OG type. Defaults to "website". Use "article" for guide/editorial pages. */
  ogType?: "website" | "article";
}

const DEFAULT_OG_IMAGE = "/og-default.png";
const SITE_NAME = "Happy Hour Compass";
const LOCALE = "en_CA";

export function buildPageMetadata({
  title,
  description,
  path = "/",
  ogImage = DEFAULT_OG_IMAGE,
  ogType = "website",
}: PageMetadataOptions): Metadata {
  const canonicalUrl = absoluteUrl(path);
  const imageUrl = ogImage.startsWith("http") ? ogImage : absoluteUrl(ogImage);
  const noindex = shouldNoIndex();

  return {
    title,
    description,
    ...(noindex && { robots: { index: false, follow: false } }),
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      siteName: SITE_NAME,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      type: ogType,
      locale: LOCALE,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

/**
 * Venue page metadata builder.
 *
 * Phase 2: wire in OG image from the venue's primary photo.
 * Phase 3: add LocalBusiness + FoodEstablishment JSON-LD via a separate helper.
 */
export function buildVenueMetadata({
  venueName,
  description,
  slug,
  ogImage,
}: {
  venueName: string;
  description: string;
  slug: string;
  ogImage?: string;
}): Metadata {
  return buildPageMetadata({
    title: venueName,
    description,
    path: `/venue/${slug}`,
    ogImage,
  });
}

/**
 * Event page metadata builder.
 *
 * Phase 2: wire in OG image from the event/venue photo.
 * Phase 3: add Event JSON-LD via a separate helper.
 */
export function buildEventMetadata({
  eventName,
  description,
  eventId,
  ogImage,
}: {
  eventName: string;
  description: string;
  eventId: string;
  ogImage?: string;
}): Metadata {
  return buildPageMetadata({
    title: eventName,
    description,
    path: `/event/${eventId}`,
    ogImage,
  });
}
