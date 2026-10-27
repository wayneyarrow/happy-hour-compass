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
import type { HomepageDetail } from "@/lib/data/homepagesShared";
import { resolveSection } from "@/lib/data/homepagesRendering";
import type { HomepagePreviewSection } from "@/lib/data/homepagesRendering";
import { reportOperationalError } from "@/lib/observability/reportOperationalError";

export type { HomepagePreviewGuideCard, HomepagePreviewFeatureCard, HomepagePreviewSection } from "@/lib/data/homepagesRendering";

/**
 * The Published Homepage record for this geography — identity (id, used by
 * discovery tracking), its own SEO fields (belonging to the Homepage that
 * was ACTUALLY resolved — city or market fallback — never fabricated for the
 * fallback geography) and its enabled Sections in saved display order, not
 * yet resolved to content. Null when neither a Published City Homepage nor
 * a Published Market Homepage exists — callers should fall back to the
 * existing Discovery Shell with no CMS-driven editorial sections in that
 * case (never a 404 — the public homepage route always renders something).
 *
 * Kept separate from resolvePublicHomepageSections() so the homepage can
 * send its header and hero (which need only this record) while the
 * Sections are still resolving, and so metadata never resolves Sections.
 */
export type HomepagePublicRecord = HomepageDetail;

export async function getPublicHomepageRecordForLocation(
  marketSlug: string,
  citySlug?: string | null
): Promise<HomepagePublicRecord | null> {
  return getPublishedHomepageForLocation(marketSlug, citySlug);
}

/**
 * Resolves a Published Homepage's Sections to rendering-ready content.
 * Already filtered to Sections that resolved to at least one usable item,
 * in saved display order. Empty array is valid — the page renders the
 * Discovery Shell with no editorial sections below it.
 *
 * Each Section resolves in isolation: one that throws (an unexpected
 * exception — the data readers themselves log and return empty on query
 * failures) is reported and left out, so it can never blank the hero or
 * the other Sections. For visitors the page has already been sent with a
 * 200 by the time Sections resolve (they stream in behind the hero), so a
 * throw here could otherwise only surface as the global error page.
 */
export async function resolvePublicHomepageSections(
  homepage: HomepagePublicRecord,
  marketSlug: string
): Promise<HomepagePreviewSection[]> {
  const resolvedSections = await Promise.all(
    homepage.sections.map(async (section) => {
      try {
        return await resolveSection(section, marketSlug);
      } catch (error) {
        reportOperationalError({
          error,
          flow: "public-homepage",
          stage: "section-resolve",
          severity: "operational",
          context: { homepageId: homepage.id, sectionId: section.id, sectionType: section.sectionType, contentMode: section.contentMode },
        });
        return null;
      }
    })
  );
  return resolvedSections.filter((s): s is HomepagePreviewSection => s !== null);
}
