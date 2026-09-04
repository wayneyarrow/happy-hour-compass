"use client";

import Link from "next/link";
import type { HomepagePreviewSection } from "@/lib/data/homepagePreview";
import { DiscoveryImpressionTracker, fireDiscoveryClick } from "@/app/(website)/discoveryTracking";

/**
 * Renders a Venue/Event/Guide Feature Section as a full-width editorial
 * layout. CTA label and destination are fixed by content type (set by the
 * data loader, homepagePreview.ts) — never editor-configurable, per the
 * Build Homepage Preview task's "Do not expose CTA text or layout controls
 * to editors."
 *
 * Teaser is the only optional piece: when the assigned content has none,
 * the layout collapses naturally (no fallback copy, no placeholder — see
 * the `feature.teaser &&` guard below). Missing/ineligible content never
 * reaches this component at all — homepagePreview.ts omits the whole
 * Section in that case.
 *
 * Alternate desktop layout (Venue Features only — polish task "Alternate the
 * desktop layout for Venue Feature sections"): Guide/Event stay image-left/
 * content-right; Venue Feature reverses to content-left/image-right at the
 * `lg:` breakpoint only, via `lg:order-*` on the same two grid children —
 * DOM order (image, then content) is untouched, so mobile's stacked
 * image → content → CTA layout is unaffected regardless of feature type.
 * The content column's horizontal padding is mirrored alongside the order
 * flip (`lg:pl-12` instead of `lg:pr-12`) so the outer breathing room stays
 * on the card's true outer edge rather than ending up against the grid gap.
 *
 * Phase 4A: "use client" added (previously a Server Component) so the CTA
 * Link can carry a discovery-tracking onClick for Venue Features — see
 * discoveryTracking.tsx. Purely presentational otherwise; no server-only
 * work was ever done in this component, so this has no other effect.
 */

type Props = {
  section: Extract<HomepagePreviewSection, { kind: "venue_feature" | "event_feature" | "guide_feature" }>;
  /**
   * Opt-in only — omitted by the Control Panel's homepage preview route
   * (control-panel/homepages/[id]/preview) so a founder/admin previewing a
   * draft Homepage never generates real discovery-attribution rows; set by
   * the live public homepage ((website)/page.tsx) only.
   */
  enableDiscoveryTracking?: boolean;
};

export function FeatureSection({ section, enableDiscoveryTracking }: Props) {
  const { feature } = section;
  const isVenueFeature = section.kind === "venue_feature";

  // Discovery attribution only applies to Featured Venue cards (this
  // phase's scope is venue discovery attribution) and only when the
  // resolved feature actually carries a venueId (see homepagesRendering.ts
  // — always true for venue_feature, never set for event/guide features).
  const discoveryContext =
    enableDiscoveryTracking && isVenueFeature && feature.venueId
      ? { context: `homepage_feature:${section.id}`, position: 0 }
      : null;

  return (
    <section className="py-10 md:py-12 border-t border-gray-100">
      {discoveryContext && feature.venueId && (
        <DiscoveryImpressionTracker
          context={discoveryContext.context}
          items={[{ venueId: feature.venueId, position: 0 }]}
        />
      )}
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center rounded-3xl overflow-hidden border border-gray-100 bg-gray-50">
          <div
            className={`relative h-[220px] sm:h-[300px] lg:h-[420px] bg-gray-100 ${
              isVenueFeature ? "lg:order-2" : ""
            }`}
          >
            {feature.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={feature.imageUrl} alt={feature.title} className="w-full h-full object-cover" />
            )}
          </div>

          <div
            className={`px-6 lg:px-0 py-8 lg:py-0 ${
              isVenueFeature ? "lg:order-1 lg:pl-12" : "lg:pr-12"
            }`}
          >
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-3">
              {feature.eyebrow}
            </p>
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-gray-900 tracking-tight leading-snug">
              {feature.title}
            </h2>
            {feature.secondaryLabel && (
              <p className="mt-2 text-sm text-gray-500">{feature.secondaryLabel}</p>
            )}
            {feature.teaser && (
              <p className="mt-4 text-base text-gray-600 leading-relaxed max-w-md">{feature.teaser}</p>
            )}
            <div className="mt-6">
              <Link
                href={feature.ctaHref}
                className="inline-flex items-center px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-sm transition-colors"
                onClick={
                  discoveryContext && feature.venueId
                    ? () => fireDiscoveryClick(feature.venueId as string, discoveryContext)
                    : undefined
                }
              >
                {feature.ctaLabel}
                <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
