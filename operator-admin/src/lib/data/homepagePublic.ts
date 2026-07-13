/**
 * Public Homepage data loader (Task 8 — Publishing and Public Homepage
 * Integration).
 *
 * Answers "what should the public homepage actually render right now for
 * this geography?" — the published-only counterpart to
 * getHomepagePreviewData (homepagePreview.ts). Never draft-inclusive: only
 * a currently-Published Homepage, with currently-Published Collections and
 * currently-eligible Feature content, is ever returned.
 *
 * Geography resolution and publish-status gating happen in
 * getPublishedHomepageForLocation (homepages.ts) — City Homepage first,
 * falling back to the parent Market Homepage, per
 * docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md "Homepage Fallback".
 * That loader already restricts to `status = 'published'`, enabled
 * Sections only, and Collection-mode Sections whose assigned Collection is
 * itself published.
 *
 * Section resolution (Collection algorithm/manual/boost resolution, card
 * mapping, Feature content eligibility) is NOT duplicated here — it reuses
 * resolveSection from homepagesRendering.ts, the exact same function the
 * Preview loader uses, so Draft Preview and Published Public rendering can
 * never drift apart on "what does this Section actually render." This is
 * also where "one invalid Section must never prevent the rest of the
 * Homepage from rendering" is enforced: each Section resolves
 * independently, and only the ones that resolve to usable content survive.
 *
 * Must only be imported from Server Components, Route Handlers, or Server
 * Actions (transitively reaches createAdminClient()).
 */

import { getPublishedHomepageForLocation } from "@/lib/data/homepages";
import type { HomepageStatus } from "@/lib/data/homepagesShared";
import { resolveSection } from "@/lib/data/homepagesRendering";
import type { HomepagePreviewSection } from "@/lib/data/homepagesRendering";

export type { HomepagePreviewGuideCard, HomepagePreviewFeatureCard, HomepagePreviewSection } from "@/lib/data/homepagesRendering";

export type HomepagePublicData = {
  id: string;
  status: HomepageStatus;
  cityName: string | null;
  marketName: string;
  /** SEO fields belonging to the Homepage that was ACTUALLY resolved (city or market fallback) — never fabricated for the fallback geography. */
  pageTitle: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  canonicalUrl: string | null;
  /** Already filtered to Sections that resolved to at least one usable item, in saved display order. Empty array is valid — the page renders the Discovery Shell with no editorial sections below it. */
  sections: HomepagePreviewSection[];
};

/**
 * Published-only Homepage resolution for a market/city, with city-to-market
 * fallback. Returns null when neither a Published City Homepage nor a
 * Published Market Homepage exists for this geography — callers should fall
 * back to the existing Discovery Shell with no CMS-driven editorial
 * sections in that case (never a 404 — the public homepage route always
 * renders something).
 */
export async function getPublicHomepageForLocation(
  marketSlug: string,
  citySlug?: string | null
): Promise<HomepagePublicData | null> {
  const homepage = await getPublishedHomepageForLocation(marketSlug, citySlug);
  if (!homepage) return null;

  const resolvedSections = await Promise.all(
    homepage.sections.map((section) => resolveSection(section, marketSlug))
  );
  const sections = resolvedSections.filter((s): s is HomepagePreviewSection => s !== null);

  return {
    id: homepage.id,
    status: homepage.status,
    cityName: homepage.cityName,
    marketName: homepage.marketName,
    pageTitle: homepage.pageTitle,
    metaTitle: homepage.metaTitle,
    metaDescription: homepage.metaDescription,
    ogTitle: homepage.ogTitle,
    ogDescription: homepage.ogDescription,
    canonicalUrl: homepage.canonicalUrl,
    sections,
  };
}
