import Link from "next/link";
import type { HomepagePreviewSection } from "@/lib/data/homepagePreview";

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
 */

type Props = {
  section: Extract<HomepagePreviewSection, { kind: "venue_feature" | "event_feature" | "guide_feature" }>;
};

export function FeatureSection({ section }: Props) {
  const { feature } = section;

  return (
    <section className="py-10 md:py-12 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center rounded-3xl overflow-hidden border border-gray-100 bg-gray-50">
          <div className="relative h-[220px] sm:h-[300px] lg:h-[420px] bg-gray-100">
            {feature.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={feature.imageUrl} alt={feature.title} className="w-full h-full object-cover" />
            )}
          </div>

          <div className="px-6 lg:px-0 lg:pr-12 py-8 lg:py-0">
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
