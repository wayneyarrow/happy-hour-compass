import Link from "next/link";
import type { HomepagePreviewSection } from "@/lib/data/homepagePreview";
import { TodaysSpecialCard } from "./TodaysSpecialCard";
import { DiscoveryImpressionTracker } from "@/app/(website)/discoveryTracking";

const TODAYS_SPECIALS_RAIL_NAME = "homepage_rail:todays-specials";

type Props = {
  section: Extract<HomepagePreviewSection, { kind: "daily_special_collection" }>;
  /** See CollectionRail.tsx/FeatureSection.tsx — omitted by the Control Panel homepage preview route, set only by the live public homepage. */
  enableDiscoveryTracking?: boolean;
};

/**
 * "Today's Specials" homepage section — now a real, CMS-driven Homepage
 * Section (`section_type = 'daily_special'`, `content_mode = 'collection'`;
 * migration 092_daily_special_collections.sql), rendered by
 * HomepageSectionsRenderer.tsx exactly like CollectionRail/FeatureSection —
 * no more hardcoded "insert after the section titled Patio Picks" logic
 * (removed; see homepageSectionPlacement.ts's deletion). Placement now
 * comes entirely from this Section's own saved `display_order`, the same
 * as every other Homepage Section.
 *
 * Purely presentational: `section` already carries the fully-resolved,
 * ranked, override-applied, eligible-today Specials (and the pre-computed
 * dynamic subtitle) from homepagesRendering.ts's resolveCollectionSection —
 * this component does no data-fetching, no ranking, no eligibility logic
 * of its own, matching how CollectionRail/FeatureSection work.
 *
 * Visual treatment is UNCHANGED from the approved grid pass: same outer
 * rhythm as every rail (see CollectionRail.tsx), a plain responsive grid
 * (1 column mobile, 2 tablet, 3 desktop), no rail/swipe behavior, no large
 * tinted outer panel.
 */
export function TodaysSpecialsSection({ section, enableDiscoveryTracking }: Props) {
  const discoveryContext = enableDiscoveryTracking ? { context: TODAYS_SPECIALS_RAIL_NAME } : null;

  return (
    <section className="py-10 md:py-12 border-t border-gray-100">
      {discoveryContext && (
        <DiscoveryImpressionTracker
          context={discoveryContext.context}
          items={section.items.map((s, i) => ({ venueId: s.venueId, position: i }))}
        />
      )}

      <div className="max-w-7xl mx-auto px-6 lg:px-10 flex items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">{section.title}</h2>
          <p className="mt-1.5 text-sm text-gray-500">{section.subtitle}</p>
        </div>
        <Link
          href={section.viewAllHref}
          className="shrink-0 text-sm font-semibold text-amber-600 hover:text-amber-700 transition-colors whitespace-nowrap"
        >
          View all →
        </Link>
      </div>

      {/* Grid, not a rail: 1 column (mobile) -> 2 (tablet, sm:) -> 3
          (desktop, lg:) — no overflow-x-auto, no fixed card widths, no
          swipe behavior. Cards fill their column via the grid track
          itself rather than an explicit width. */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {section.items.map((special, i) => (
            <TodaysSpecialCard
              key={special.id}
              special={special}
              discovery={discoveryContext ? { context: discoveryContext.context, position: i } : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
