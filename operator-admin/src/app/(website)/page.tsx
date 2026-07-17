import type { Metadata } from "next";
import HeroSection from "./HeroSection";
import { HomepageSectionsRenderer } from "./homepage/HomepageSectionsRenderer";
import { getActiveMarket } from "@/lib/activeMarket";
import { getMarketBySlug, getDefaultCityForMarket } from "@/lib/geo/geography";
import type { Market } from "@/lib/markets";
import { getPublicHomepageForLocation } from "@/lib/data/homepagePublic";
import { buildPageMetadata } from "@/lib/seo/metadata";

// Resolves the consumer-facing city name (and slug, for public Homepage
// geography resolution — Task 8) for the hero's search placeholder. Mirrors
// the fallback pattern in layout.tsx's header city lookup — falls back to
// the market config name, with no city context, if the DB geography lookup
// is unavailable.
async function getHeroCityContext(market: Market): Promise<{ cityName: string; citySlug: string | null }> {
  try {
    const marketRecord = await getMarketBySlug(market.id);
    if (marketRecord) {
      const defaultCity = await getDefaultCityForMarket(marketRecord.id);
      if (defaultCity) return { cityName: defaultCity.name, citySlug: defaultCity.slug };
    }
  } catch {
    // DB unavailable — fall back to market config name.
  }
  return { cityName: market.name, citySlug: null };
}

const DEFAULT_TITLE = "Happy Hour Compass — Find the best happy hours near you";
const DEFAULT_DESCRIPTION =
  "Discover curated happy hour deals at bars and restaurants near you. Real menus, real prices, real hours — updated by the venues themselves.";

/**
 * Sitewide brand asset used as the homepage's Open Graph / Twitter image —
 * the same fallback the Guide detail page already uses
 * ((website)/[market]/guides/[slug]/page.tsx) and the asset
 * src/lib/seo/schema/organization.ts documents as "the" standalone brand
 * logo in every other external-facing context. Deliberately NOT
 * buildPageMetadata's own DEFAULT_OG_IMAGE ("/og-default.png") — that path
 * has no real file behind it in /public today.
 */
const HOMEPAGE_OG_IMAGE = "/logo.png";

/**
 * Public Homepage SEO (Task 8 — Publishing and Public Homepage Integration;
 * canonical/OG/Twitter behavior revised per the Homepage Metadata
 * Investigation).
 *
 * Uses the SEO metadata belonging to the Homepage that is ACTUALLY
 * rendered — when a city falls back to its parent market Homepage, that
 * means the market Homepage's own SEO fields, never fabricated
 * city-specific metadata. Falls back to the site-wide defaults above for
 * any field the editor left empty, and when no Homepage is published for
 * this geography at all.
 *
 * Canonical is always "/" — deliberately NOT the per-geography
 * /{market-slug}/{city-slug} (or /{market-slug}) path
 * generateHomepageSeo() computes and the Homepage CMS's own canonicalUrl
 * field stores (src/lib/seo/homepageSeo.ts,
 * control-panel/homepages/HomepageForm.tsx). That path shape matches the
 * target Geographic Information Architecture documented in
 * WEBSITE_PRODUCT_PLAYBOOK.md, but no /{market} or /{market}/{city} route
 * exists yet anywhere in the app — the public homepage is only ever
 * reachable at "/", with the active market/city resolved server-side from
 * a cookie (getActiveMarket()), never from the URL. A canonical tag must
 * point at a URL that actually resolves today; the per-geography path
 * 404s for every visitor and every crawler regardless of which Homepage
 * record is live. This is a sequencing gap between the SEO layer and the
 * routing layer, not a reason to change the CMS's forward-looking
 * canonicalUrl field itself — once dedicated market/city routes ship,
 * this is the one place that needs to start using them.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { market } = await getActiveMarket();
  const { citySlug } = await getHeroCityContext(market);
  const homepage = await getPublicHomepageForLocation(market.id, citySlug);

  const title = homepage?.metaTitle ?? homepage?.pageTitle ?? DEFAULT_TITLE;
  const description = homepage?.metaDescription ?? DEFAULT_DESCRIPTION;

  // path/canonicalPath deliberately omitted — buildPageMetadata defaults
  // both to "/", which is exactly the live route this metadata is for.
  const base = buildPageMetadata({
    title,
    description,
    ogImage: HOMEPAGE_OG_IMAGE,
    ogTitle: homepage?.ogTitle ?? undefined,
    ogDescription: homepage?.ogDescription ?? undefined,
  });

  // buildPageMetadata() returns a plain-string `title`, which the root
  // layout's "%s — Happy Hour Compass" template (src/app/layout.tsx) would
  // wrap and double-brand. `title: { absolute }` bypasses that template —
  // the same fix already applied on the Guide detail page
  // ((website)/[market]/guides/[slug]/page.tsx). Title templating itself is
  // otherwise unchanged by this task.
  return { ...base, title: { absolute: title } };
}

// ─── Page ────────────────────────────────────────────────────────────────────
// The Discovery Shell (header + Hero) is the only product-owned content
// below this point that is not driven by the Homepage CMS. Everything else
// on the public homepage is owned by the published Homepage's editorial
// Sections — there is no legacy static fallback content. When no Homepage
// is published for this geography (neither City nor Market), the page
// simply ends after the Hero; see docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md.

export default async function WebsiteHomePage() {
  const { market, isPersisted } = await getActiveMarket();
  const { cityName, citySlug } = await getHeroCityContext(market);
  const homepage = await getPublicHomepageForLocation(market.id, citySlug);

  return (
    <>
      <HeroSection market={market} cityName={cityName} isPersisted={isPersisted} />
      {homepage && <HomepageSectionsRenderer sections={homepage.sections} />}
    </>
  );
}
