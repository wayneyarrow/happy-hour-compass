import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { userAgent } from "next/server";
import HeroSection from "../HeroSection";
import { HomepageSectionsRenderer } from "./HomepageSectionsRenderer";
import { HomepageSectionsPlaceholder } from "./HomepageSectionsPlaceholder";
import { HomepageSectionsErrorBoundary } from "./HomepageSectionsErrorBoundary";
import { DiscoveryPageTracking } from "../tracking/DiscoveryTrackingProvider";
import { WeeklyPicksSection } from "../weekly-picks/WeeklyPicksSection";
import { splitSectionsAroundSignup } from "@/lib/weeklyPicks/weeklyPicks";
import { getAvailableNewsletterMarket } from "@/lib/weeklyPicks/newsletterAvailability";
import { getMarketBySlug, getDefaultCityForMarket } from "@/lib/geo/geography";
import { resolveMarketLocationLabel, type Market } from "@/lib/markets";
import {
  getPublicHomepageRecordForLocation,
  resolvePublicHomepageSections,
  type HomepagePublicRecord,
  type HomepagePreviewSection,
} from "@/lib/data/homepagePublic";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { DAILY_SPECIALS_NEW_UNTIL, isFeatureNewBadgeVisible } from "@/lib/newBadge";

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
      // The slug still drives Homepage geography resolution; only the
      // display name follows the market's location-label setting.
      if (defaultCity) return { cityName: resolveMarketLocationLabel(market, defaultCity.name), citySlug: defaultCity.slug };
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
 * Public Homepage SEO for one market's homepage URL (src/lib/marketHomepage.ts):
 * "/" always renders Central Okanagan, "/greater-san-diego" renders Greater
 * San Diego. Each route passes its own market and its own URL path, which
 * is also its self-referencing canonical, so one URL never carries two
 * markets' metadata.
 *
 * Uses the SEO metadata belonging to the Homepage that is ACTUALLY
 * rendered — when a city falls back to its parent market Homepage, that
 * means the market Homepage's own SEO fields, never fabricated
 * city-specific metadata. Falls back to the site-wide defaults above for
 * any field the editor left empty, and when no Homepage is published for
 * this geography at all.
 *
 * Canonical is the route's own path, deliberately NOT the Homepage CMS's
 * stored canonicalUrl field (generateHomepageSeo(), src/lib/seo/homepageSeo.ts),
 * which is shaped for the future /{market-slug}/{city-slug} architecture in
 * WEBSITE_PRODUCT_PLAYBOOK.md that doesn't exist yet. A canonical tag must
 * point at a URL that actually resolves today.
 */
export async function generateMarketHomepageMetadata(market: Market, path: string): Promise<Metadata> {
  const { citySlug } = await getHeroCityContext(market);
  // The Homepage record only — its SEO fields are on the record itself, so
  // metadata never waits for (or triggers) Section resolution.
  const homepage = await getPublicHomepageRecordForLocation(market.id, citySlug);

  const title = homepage?.metaTitle ?? homepage?.pageTitle ?? DEFAULT_TITLE;
  const description = homepage?.metaDescription ?? DEFAULT_DESCRIPTION;

  // path is this homepage's own URL ("/" or "/greater-san-diego"), so
  // canonical, og:url and twitter all self-reference the live route.
  // ogImage also omitted — the Homepage CMS has no image field of its own
  // (see HomepageDetail), so this falls through to buildPageMetadata's
  // own DEFAULT_OG_IMAGE, the same sitewide brand asset every other
  // image-less page already falls back to.
  const base = buildPageMetadata({
    path,
    title,
    description,
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
// on the public homepage — including Today's Specials as of migration
// 092_daily_special_collections.sql — is owned by the published Homepage's
// editorial Sections, in their own saved displayOrder; there is no legacy
// static fallback content and no hardcoded section insertion — the one
// exception is the fixed Weekly Picks newsletter signup (after the first
// displayed section, and near the bottom), which is never a CMS section.
// When no Homepage is published for this geography (neither City nor
// Market), the page shows the Hero and the bottom signup only; see
// docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md.

export async function MarketHomepage({ market }: { market: Market }) {
  const { citySlug } = await getHeroCityContext(market);
  // Only the Homepage record (identity for discovery tracking, plus its
  // enabled Sections in saved order) is awaited here. Section content is
  // resolved inside the Suspense boundary below, so the header and hero are
  // sent as soon as this record is known, and the Sections stream in after
  // (HomepageSectionsPlaceholder holds their space meanwhile).
  const homepage = await getPublicHomepageRecordForLocation(market.id, citySlug);

  // Recognised crawlers and link-preview bots (Next's userAgent().isBot:
  // Googlebot, Bingbot, facebookexternalhit, Twitterbot, …) get the same
  // page fully rendered in document order instead of streamed — identical
  // content and markup, just sent once everything has resolved (the
  // pre-streaming behaviour). Streamed Sections arrive in hidden blocks
  // that a script moves into place, so a crawler that doesn't run
  // JavaScript would otherwise never see them in the page.
  const renderAllAtOnce = userAgent({ headers: await headers() }).isBot;

  // DiscoveryPageTracking: one discovery-tracking page view per mounted
  // homepage (website_discovery_events, migration 110). Only the live public
  // homepage is wrapped — the Control Panel preview renders the same
  // components without it and records nothing.
  return (
    <DiscoveryPageTracking marketId={market.id} homepageId={homepage?.id ?? null}>
      <HeroSection
        market={market}
        dailySpecialsNewBadgeVisible={isFeatureNewBadgeVisible(new Date(), DAILY_SPECIALS_NEW_UNTIL)}
      />
      {homepage ? (
        <HomepageSectionsErrorBoundary>
          {renderAllAtOnce ? (
            <HomepageEditorialSections homepage={homepage} marketSlug={market.id} />
          ) : (
            <Suspense fallback={<HomepageSectionsPlaceholder />}>
              <HomepageEditorialSections homepage={homepage} marketSlug={market.id} />
            </Suspense>
          )}
        </HomepageSectionsErrorBoundary>
      ) : (
        <HomepageSectionsWithSignup sections={[]} marketSlug={market.id} />
      )}
    </DiscoveryPageTracking>
  );
}

async function HomepageEditorialSections({ homepage, marketSlug }: { homepage: HomepagePublicRecord; marketSlug: string }) {
  const sections = await resolvePublicHomepageSections(homepage, marketSlug);
  return <HomepageSectionsWithSignup sections={sections} marketSlug={marketSlug} />;
}

// Weekly Picks signup sits OUTSIDE the CMS section list. `sections` is
// already filtered to enabled sections that resolved to content
// (homepagePublic.ts), so its first entry is the first section actually
// displayed. The list is rendered in two slices around the main signup;
// section ids, kinds, order and discovery placements are unchanged
// (tracking keys by section id, never by index). The Control Panel
// preview renders HomepageSectionsRenderer directly and is unaffected.
// Each market signs up for its own newsletter (getAvailableNewsletterMarket);
// a market without one, or with its signup switched off in this
// deployment, renders the same sections with no signup.
function HomepageSectionsWithSignup({
  sections,
  marketSlug,
}: {
  sections: HomepagePreviewSection[];
  marketSlug: string;
}) {
  const newsletter = getAvailableNewsletterMarket(marketSlug);
  if (!newsletter) {
    return sections.length > 0 ? <HomepageSectionsRenderer sections={sections} /> : null;
  }
  const split = splitSectionsAroundSignup(sections);
  return (
    <>
      {split.showMainSignup && (
        <>
          <HomepageSectionsRenderer sections={split.first} />
          <WeeklyPicksSection placement="homepage_main" newsletter={newsletter} variant="full" layout="page-width" />
        </>
      )}
      {split.rest.length > 0 && <HomepageSectionsRenderer sections={split.rest} />}
      {split.showBottomSignup && (
        <WeeklyPicksSection placement="homepage_bottom" newsletter={newsletter} variant="compact" layout="page-width" />
      )}
    </>
  );
}
