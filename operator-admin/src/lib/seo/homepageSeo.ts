import { getMetaTitleWarning, getMetaDescriptionWarning } from "./contentGuideSeo";

/**
 * SEO generation for Homepages (Homepage Management V1 foundation).
 * Mirrors contentGuideSeo.ts's shape and conventions — pure, isomorphic (no
 * DB / server-only calls), so it can run live in the browser as the admin
 * fills in Geography, the same way GuideForm drives generateGuideSeo() from
 * its own Location/Title/Keywords fields.
 *
 * canonical_url is generated as a root-relative path (not an absolute URL),
 * matching contentGuideSeo.ts's canonical_url convention, and follows the
 * Canonical URL Structure in docs/website/WEBSITE_PRODUCT_PLAYBOOK.md:
 * /{market-slug} for a Market Homepage, /{market-slug}/{city-slug} for a
 * City Homepage.
 *
 * getMetaTitleWarning / getMetaDescriptionWarning are reused directly from
 * contentGuideSeo.ts — both are generic length checks with no guide-specific
 * logic. Only the canonical URL pattern differs (guides vs. homepages), so
 * only that warning is re-implemented here.
 */

export type SeoFieldKey =
  | "page_title"
  | "meta_title"
  | "meta_description"
  | "og_title"
  | "og_description"
  | "canonical_url";

export type GeneratedSeoField = {
  value: string;
  /** Lower-case, comma-joinable source labels — e.g. ["city", "brand"]. */
  generatedFrom: string[];
};

export type GeneratedHomepageSeo = Record<SeoFieldKey, GeneratedSeoField>;

export type HomepageSeoInputs = {
  marketName: string;
  marketSlug: string;
  cityName: string | null;
  citySlug: string | null;
};

const BRAND = "Happy Hour Compass";

export { getMetaTitleWarning, getMetaDescriptionWarning };
export const META_TITLE_MAX_LEN = 60;
export const OG_TITLE_MAX_LEN = 70;
export const META_DESCRIPTION_MAX_LEN = 160;
export const OG_DESCRIPTION_MAX_LEN = 200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** System-generated display name — "Burnaby Homepage" (city) or "Greater Vancouver Homepage" (market). */
export function homepageDisplayName(marketName: string, cityName: string | null): string {
  const label = cityName || marketName;
  return label ? `${label} Homepage` : "";
}

export function generateHomepageSeo(inputs: HomepageSeoInputs): GeneratedHomepageSeo {
  const { marketName, marketSlug, cityName, citySlug } = inputs;

  const location = cityName || marketName;
  const locationSource = cityName ? "city" : marketName ? "market" : null;
  const sources = [locationSource, "brand"].filter((s): s is string => Boolean(s));

  const pageTitleValue = [location, BRAND].filter(Boolean).join(" | ") || BRAND;

  const metaTitleValue = truncate([location, BRAND].filter(Boolean).join(" | ") || BRAND, META_TITLE_MAX_LEN);

  const ogTitleValue = truncate(location || BRAND, OG_TITLE_MAX_LEN);
  const ogTitleSources = [locationSource].filter((s): s is string => Boolean(s));

  const descriptionBase = location
    ? `Find the best happy hour deals in ${location} — venues, events, and local picks from ${BRAND}.`
    : `Find the best happy hour deals — venues, events, and local picks from ${BRAND}.`;

  const canonicalUrlValue =
    cityName && citySlug && marketSlug
      ? `/${marketSlug}/${citySlug}`
      : marketSlug
        ? `/${marketSlug}`
        : "";
  const canonicalUrlSources = cityName ? ["market slug", "city slug"] : ["market slug"];

  return {
    page_title: { value: pageTitleValue, generatedFrom: sources },
    meta_title: { value: metaTitleValue, generatedFrom: sources },
    meta_description: { value: truncate(descriptionBase, META_DESCRIPTION_MAX_LEN), generatedFrom: sources },
    og_title: { value: ogTitleValue, generatedFrom: ogTitleSources },
    og_description: { value: truncate(descriptionBase, OG_DESCRIPTION_MAX_LEN), generatedFrom: sources },
    canonical_url: { value: canonicalUrlValue, generatedFrom: canonicalUrlSources },
  };
}

const MARKET_CANONICAL_PATTERN = /^\/[a-z0-9-]+$/;
const CITY_CANONICAL_PATTERN = /^\/[a-z0-9-]+\/[a-z0-9-]+$/;

export function getHomepageCanonicalUrlWarning(value: string, isCityHomepage: boolean): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const pattern = isCityHomepage ? CITY_CANONICAL_PATTERN : MARKET_CANONICAL_PATTERN;
  if (pattern.test(trimmed)) return null;
  return isCityHomepage
    ? "Expected pattern: /{market-slug}/{city-slug}."
    : "Expected pattern: /{market-slug}.";
}
