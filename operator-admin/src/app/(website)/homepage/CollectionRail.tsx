import Link from "next/link";
import { SearchResultCard } from "@/app/(website)/website-happy-hours/SearchResultCard";
import { EventSearchCard } from "@/app/(website)/website-events/EventSearchCard";
import { GuideCard } from "@/app/(website)/GuideCard";
import { DiscoveryImpressionTracker } from "@/app/(website)/discoveryTracking";
import type { HomepagePreviewSection } from "@/lib/data/homepagePreview";

/**
 * Renders a Venue/Event/Guide Collection Section as a horizontal editorial
 * rail — the editor-defined public heading, an automatic "View All" CTA
 * (the destination always already exists — it's this Section's assigned
 * Collection's own public Landing Page, built once in
 * homepagesRendering.ts's resolveCollectionSection() via
 * buildCollectionLandingHref(), so it's never conditionally omitted here),
 * and the resolved Collection items using the SAME public card components
 * the rest of the website already uses (SearchResultCard, EventSearchCard,
 * GuideCard) — nothing about card rendering is reimplemented or redesigned
 * here, only wrapped in a fixed-width, horizontally-scrollable track.
 *
 * Collection rails never show a Teaser (that's a Feature-only concept — see
 * FeatureSection.tsx) — these card components simply don't accept one.
 *
 * Phase 4A: venue_collection rails opt into discovery attribution (see
 * discoveryTracking.tsx) when enableDiscoveryTracking is set — event_collection
 * and guide_collection rails are unaffected (out of scope: this phase is
 * venue discovery attribution only). Stays a Server Component; the actual
 * click/impression side effects live in the Client Components it renders
 * (SearchResultCard, DiscoveryImpressionTracker).
 */

type Props = {
  section: Extract<HomepagePreviewSection, { kind: "venue_collection" | "event_collection" | "guide_collection" }>;
  enableDiscoveryTracking?: boolean;
};

export function CollectionRail({ section, enableDiscoveryTracking }: Props) {
  const discoveryContextName =
    section.kind === "venue_collection" && enableDiscoveryTracking
      ? `homepage_rail:${section.id}`
      : null;

  return (
    <section className="py-10 md:py-12 border-t border-gray-100">
      {discoveryContextName && section.kind === "venue_collection" && (
        <DiscoveryImpressionTracker
          context={discoveryContextName}
          items={section.items.map((v, i) => ({ venueId: v.venueUuid, position: i }))}
        />
      )}
      <div className="max-w-7xl mx-auto px-6 lg:px-10 flex items-end justify-between gap-4 mb-6">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">{section.title}</h2>
        <Link
          href={section.viewAllHref}
          className="shrink-0 text-sm font-semibold text-amber-600 hover:text-amber-700 transition-colors whitespace-nowrap"
        >
          View all →
        </Link>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-10 overflow-x-auto">
        <div className="flex gap-5 pb-2">
          {section.kind === "venue_collection" &&
            section.items.map((v, i) => (
              <div key={v.venueUuid} className="w-[300px] shrink-0">
                <SearchResultCard
                  data={v}
                  discovery={discoveryContextName ? { context: discoveryContextName, position: i } : undefined}
                />
              </div>
            ))}
          {section.kind === "event_collection" &&
            section.items.map((e) => (
              <div key={e.id} className="w-[300px] shrink-0">
                <EventSearchCard event={e} />
              </div>
            ))}
          {section.kind === "guide_collection" &&
            section.items.map((g) => (
              <div key={g.id} className="w-[220px] shrink-0">
                <GuideCard guideId={g.id} title={g.title} href={g.href} heroImageUrl={g.heroImageUrl} />
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}
