import type { GuideType } from "@/lib/data/contentGuides";

/**
 * SEO generation for Content Engine guides (Card 4).
 *
 * Pure, isomorphic (no DB / server-only calls) so it can run live in the
 * browser as the admin edits a guide in GuideForm — see
 * CONTENT_ENGINE_PRODUCT_SPEC.md section 11 "SEO Automation":
 *   "The editor provides: Primary Keyword, Secondary Keywords, Guide Title,
 *    Editorial copy. The Content Engine automatically generates: URL, Page
 *    Title, Meta Title, Meta Description, Open Graph metadata, Canonical
 *    URL. Every generated field displays Generated From. Editors may
 *    override any generated value."
 *
 * This module only computes *suggestions* — GuideForm decides whether to
 * apply a suggestion to a given field (only while that field hasn't been
 * manually edited) and the actual saved values are whatever ends up in the
 * form's page_title/meta_title/etc. inputs at submit time, same as any
 * other guide field.
 *
 * canonical_url is generated as a root-relative path (not an absolute URL)
 * so it stays valid across environments without depending on
 * @/lib/siteUrl's getSiteUrl(), which reads server-only env vars
 * (VERCEL_ENV / VERCEL_URL) that aren't available in this client-run code.
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
  /** Lower-case, comma-joinable source labels — e.g. ["primary keyword", "city", "brand"]. */
  generatedFrom: string[];
};

export type GeneratedGuideSeo = Record<SeoFieldKey, GeneratedSeoField>;

export type ContentGuideSeoInputs = {
  guideType: GuideType | "";
  marketName: string;
  marketSlug: string;
  cityName: string;
  neighbourhoodName?: string | null;
  title: string;
  slug: string;
  primaryKeyword?: string | null;
  secondaryKeywords?: string[];
  intro?: string | null;
  /** Guide Experience V2 Card 2A: the editor's new primary content field — checked ahead of the legacy `body`. */
  editorialSection1Body?: string | null;
  /** Legacy free-text content (Card 2/3), kept only as a fallback for guides that predate the editorial sections. */
  body?: string | null;
};

const BRAND = "Happy Hour Compass";

export const META_TITLE_MAX_LEN = 60;
export const OG_TITLE_MAX_LEN = 70;
export const META_DESCRIPTION_MAX_LEN = 160;
export const OG_DESCRIPTION_MAX_LEN = 200;

// ── Small text helpers ───────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function capitalizeWords(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The narrowest available location label, plus which input it came from —
 * neighbourhood (with its city) > city > market. Mirrors the same
 * neighbourhood → city → market priority used by the attachment selector's
 * geography tiers (Card 3), so SEO copy and attachment relevance read from
 * the same mental model of "narrowest known location wins".
 */
function locationInfo(
  marketName: string,
  cityName: string,
  neighbourhoodName?: string | null
): { label: string; source: string | null } {
  if (neighbourhoodName && cityName) {
    return { label: `${neighbourhoodName}, ${cityName}`, source: "neighbourhood" };
  }
  if (cityName) return { label: cityName, source: "city" };
  if (marketName) return { label: marketName, source: "market" };
  return { label: "", source: null };
}

// ── Generation ────────────────────────────────────────────────────────────────

export function generateGuideSeo(inputs: ContentGuideSeoInputs): GeneratedGuideSeo {
  const {
    guideType, marketName, marketSlug, cityName, neighbourhoodName,
    title, slug, primaryKeyword, secondaryKeywords, intro, editorialSection1Body, body,
  } = inputs;

  const guideTitle = normalizeWhitespace(title);
  const keyword = normalizeWhitespace(primaryKeyword ?? "");
  const secondary = (secondaryKeywords ?? []).map((k) => k.trim()).filter(Boolean)[0] ?? "";
  const location = locationInfo(marketName, cityName, neighbourhoodName);
  const kindWord = guideType === "event_guide" ? "events" : "venues";

  // ── page_title — full, descriptive; not length-capped like meta_title,
  // since it's the browser tab / page title, not what Google truncates.
  const pageTitleSubject = guideTitle || (keyword ? capitalizeWords(keyword) : "Untitled Guide");
  const pageTitleParts = [pageTitleSubject, location.label, BRAND].filter(Boolean);
  const pageTitleSources = ["guide title", location.source, "brand"].filter(
    (s): s is string => Boolean(s)
  );

  // ── meta_title — keyword-led when a primary keyword exists (more
  // search-intent-aligned than the editorial guide title), capped short.
  const metaTitleSubject = keyword ? capitalizeWords(keyword) : guideTitle || "Untitled Guide";
  const metaTitleValue = truncate(
    [metaTitleSubject, location.label].filter(Boolean).join(" | "),
    META_TITLE_MAX_LEN
  );
  const metaTitleSources = [keyword ? "primary keyword" : "guide title", location.source].filter(
    (s): s is string => Boolean(s)
  );

  // ── og_title — same subject as meta_title, slightly more room, no brand
  // suffix (buildPageMetadata already sends siteName separately).
  const ogTitleValue = truncate(
    [guideTitle || metaTitleSubject, location.label].filter(Boolean).join(" | "),
    OG_TITLE_MAX_LEN
  );
  const ogTitleSources = ["guide title", location.source].filter((s): s is string => Boolean(s));

  // ── meta_description / og_description share one composed base text:
  // guide intro → editorial section 1 body → legacy guide body → a composed
  // fallback sentence. Only the fallback sentence pulls in keyword/secondary
  // keyword/location/brand; intro/section/body are used verbatim (trimmed +
  // truncated) since they're already editorial copy written for a reader.
  // Editorial section 1 body sits ahead of the legacy body so newly-authored
  // guides (which never populate `body`) still get a real content-derived
  // description instead of falling straight to the generic sentence.
  const introText = normalizeWhitespace(intro ?? "");
  const editorialSection1Text = normalizeWhitespace(editorialSection1Body ?? "");
  const bodyText = normalizeWhitespace(body ?? "");

  let descriptionBase: string;
  let descriptionSources: string[];

  if (introText) {
    descriptionBase = introText;
    descriptionSources = ["guide intro"];
  } else if (editorialSection1Text) {
    descriptionBase = editorialSection1Text;
    descriptionSources = ["editorial section 1"];
  } else if (bodyText) {
    descriptionBase = bodyText;
    descriptionSources = ["guide body"];
  } else {
    const subject = keyword || guideTitle || `happy hour ${kindWord}`;
    const locationPhrase = location.label ? ` in ${location.label}` : "";
    const secondaryPhrase = secondary ? ` — featuring ${secondary}` : "";
    descriptionBase = `Discover ${subject}${locationPhrase}${secondaryPhrase}. Curated picks from ${BRAND}.`;
    descriptionSources = [keyword ? "primary keyword" : "guide title", location.source, secondary ? "secondary keywords" : null, "brand"].filter(
      (s): s is string => Boolean(s)
    );
  }

  const metaDescriptionValue = truncate(descriptionBase, META_DESCRIPTION_MAX_LEN);
  const ogDescriptionValue = truncate(descriptionBase, OG_DESCRIPTION_MAX_LEN);

  // ── canonical_url — locked structure: /{market-slug}/guides/{guide-slug}.
  // Root-relative on purpose — see module docstring.
  const canonicalUrlValue = marketSlug && slug ? `/${marketSlug}/guides/${slug}` : "";
  const canonicalUrlSources = ["market slug", "guide slug"];

  return {
    page_title: { value: pageTitleParts.join(" | "), generatedFrom: pageTitleSources },
    meta_title: { value: metaTitleValue, generatedFrom: metaTitleSources },
    meta_description: { value: metaDescriptionValue, generatedFrom: descriptionSources },
    og_title: { value: ogTitleValue, generatedFrom: ogTitleSources },
    og_description: { value: ogDescriptionValue, generatedFrom: descriptionSources },
    canonical_url: { value: canonicalUrlValue, generatedFrom: canonicalUrlSources },
  };
}

// ── Non-blocking validation warnings ─────────────────────────────────────────
// "Basic validation... Do not block saving for minor SEO length warnings" —
// these are pure functions the editor calls live (no server round-trip),
// since save/redirect happens immediately on success and would otherwise
// carry the warning off-screen before the admin ever saw it.

export function getMetaTitleWarning(value: string): string | null {
  const len = value.trim().length;
  if (len === 0 || len <= META_TITLE_MAX_LEN) return null;
  return `${len} characters — search engines typically truncate meta titles above ${META_TITLE_MAX_LEN}.`;
}

export function getMetaDescriptionWarning(value: string): string | null {
  const len = value.trim().length;
  if (len === 0 || len <= META_DESCRIPTION_MAX_LEN) return null;
  return `${len} characters — search engines typically truncate meta descriptions above ${META_DESCRIPTION_MAX_LEN}.`;
}

const CANONICAL_URL_PATTERN = /^\/[a-z0-9-]+\/guides\/[a-z0-9-]+$/;

export function getCanonicalUrlWarning(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || CANONICAL_URL_PATTERN.test(trimmed)) return null;
  return "Expected pattern: /{market-slug}/guides/{guide-slug}.";
}
