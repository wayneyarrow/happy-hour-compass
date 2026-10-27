import Link from "next/link";
import type { HomepagePreviewSection } from "@/lib/data/homepagePreview";
import { SectionExposureMarker, TrackedDiscoveryItem } from "@/app/(website)/tracking/TrackedDiscovery";

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
 * Discovery tracking (migration 110, all three feature kinds): the feature
 * card is one TrackedDiscoveryItem at position 0 (visible impression + CTA
 * click) and its eyebrow/title block is the section-exposure marker. The
 * placement (this Section) comes from HomepageSectionsRenderer; outside a
 * tracked page these render as plain wrappers. A Server Component again —
 * the tracking side effects live in those Client Components.
 */

type Props = {
  section: Extract<HomepagePreviewSection, { kind: "venue_feature" | "event_feature" | "guide_feature" }>;
};

export function FeatureSection({ section }: Props) {
  const { feature } = section;
  const isVenueFeature = section.kind === "venue_feature";

  return (
    <section className="py-10 md:py-12 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <TrackedDiscoveryItem
          itemType={feature.trackingItem.itemType}
          itemId={feature.trackingItem.itemId}
          position={0}
          className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center rounded-3xl overflow-hidden border border-gray-100 bg-gray-50"
        >
          <div
            className={`relative h-[220px] sm:h-[300px] lg:h-[420px] bg-gray-100 ${
              isVenueFeature ? "lg:order-2" : ""
            }`}
          >
            {feature.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={feature.imageUrl} alt={feature.title} loading="lazy" decoding="async" className="w-full h-full object-cover" />
            )}
          </div>

          <div
            className={`px-6 lg:px-0 py-8 lg:py-0 ${
              isVenueFeature ? "lg:order-1 lg:pl-12" : "lg:pr-12"
            }`}
          >
            <SectionExposureMarker>
              <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-3">
                {feature.eyebrow}
              </p>
              <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-gray-900 tracking-tight leading-snug">
                {feature.title}
              </h2>
            </SectionExposureMarker>
            {feature.secondaryLabel && (
              <p className="mt-2 text-sm text-gray-500">{feature.secondaryLabel}</p>
            )}
            {feature.teaser && (
              <p className="mt-4 text-base text-gray-600 leading-relaxed max-w-md">
                {/* Every Feature teaser (Guide, Venue, Event): opts this text out of Google
                    snippet selection so one featured item's narrow angle or promo copy (e.g.
                    "$3.88 Happy Hour…") can't become the homepage's search snippet.
                    data-nosnippet is only Google-recognized on span/div/section, never p, and
                    doesn't affect crawling/indexing of the text, the title, or the CTA link. */}
                <span data-nosnippet>{feature.teaser}</span>
              </p>
            )}
            <div className="mt-6">
              <Link
                href={feature.ctaHref}
                className="inline-flex items-center px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-sm transition-colors"
              >
                {feature.ctaLabel}
                <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>
          </div>
        </TrackedDiscoveryItem>
      </div>
    </section>
  );
}
