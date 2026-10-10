import type { HomepagePreviewSection } from "@/lib/data/homepagePreview";
import { TodaysSpecialCard } from "./TodaysSpecialCard";
import { SectionExposureMarker, TrackedDiscoveryItem, TrackedViewAllLink } from "@/app/(website)/tracking/TrackedDiscovery";

type Props = {
  section: Extract<HomepagePreviewSection, { kind: "daily_special_collection" }>;
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
 *
 * Discovery tracking (migration 110): placement = this Section's real id
 * (the pre-110 fixed "homepage_rail:todays-specials" name is gone); each card
 * is tracked as a daily_special item by the Special's own id, so two
 * Specials from one venue are distinguishable. Heading row = exposure marker.
 */
export function TodaysSpecialsSection({ section }: Props) {
  return (
    <section className="py-10 md:py-12 border-t border-gray-100">
      <SectionExposureMarker className="max-w-7xl mx-auto px-6 lg:px-10 flex items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">{section.title}</h2>
          <p className="mt-1.5 text-sm text-gray-500">{section.subtitle}</p>
        </div>
        <TrackedViewAllLink
          href={section.viewAllHref}
          className="shrink-0 text-sm font-semibold text-amber-600 hover:text-amber-700 transition-colors whitespace-nowrap"
        >
          View all →
        </TrackedViewAllLink>
      </SectionExposureMarker>

      {/* Grid, not a rail: 1 column (mobile) -> 2 (tablet, sm:) -> 3
          (desktop, lg:) — no overflow-x-auto, no fixed card widths, no
          swipe behavior. Cards fill their column via the grid track
          itself rather than an explicit width. */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {section.items.map((special, i) => (
            <TrackedDiscoveryItem key={special.id} itemType="daily_special" itemId={special.id} position={i} className="grid">
              <TodaysSpecialCard special={special} />
            </TrackedDiscoveryItem>
          ))}
        </div>
      </div>
    </section>
  );
}
