/**
 * Shared image-field helper for schema builders.
 *
 * Every image field in the current data model (venue images, event
 * imageUrl, guide hero_image_url) is a plain URL, with no stored width,
 * height, or caption — so schema `image` fields use plain absolute URL
 * strings, not ImageObject nodes. This is explicitly valid per schema.org
 * and Google's structured-data guidance, not a placeholder pending a
 * future upgrade to ImageObject; that upgrade only becomes correct once
 * the upload pipeline persists real dimensions to fill an ImageObject
 * with (see the structured data architecture review's ImageObject
 * recommendation).
 */

import { absoluteUrl } from "@/lib/siteUrl";

/** Resolves a possibly-relative image URL to an absolute one for schema `image` fields. Returns undefined for empty input so callers can safely spread the result and have the key disappear rather than serialize as null/empty. */
export function toSchemaImage(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith("http") ? url : absoluteUrl(url);
}
