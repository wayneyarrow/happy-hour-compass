import Link from "next/link";
import { SearchResultCard } from "@/app/(website)/website-happy-hours/SearchResultCard";
import { EventSearchCard } from "@/app/(website)/website-events/EventSearchCard";
import { GuideCard } from "@/app/(website)/GuideCard";
import type { HomepagePreviewSection } from "@/lib/data/homepagePreview";

/**
 * Renders a Venue/Event/Guide Collection Section as a horizontal editorial
 * rail — the editor-defined public heading, an automatic "View All" CTA
 * (the destination always already exists — see homepagePreview.ts's
 * VIEW_ALL_HREF — so it's never conditionally omitted here), and the
 * resolved Collection items using the SAME public card components the rest
 * of the website already uses (SearchResultCard, EventSearchCard, GuideCard)
 * — nothing about card rendering is reimplemented or redesigned here, only
 * wrapped in a fixed-width, horizontally-scrollable track.
 *
 * Collection rails never show a Teaser (that's a Feature-only concept — see
 * FeatureSection.tsx) — these card components simply don't accept one.
 */

type Props = {
  section: Extract<HomepagePreviewSection, { kind: "venue_collection" | "event_collection" | "guide_collection" }>;
};

export function CollectionRail({ section }: Props) {
  return (
    <section className="py-10 md:py-12 border-t border-gray-100">
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
            section.items.map((v) => (
              <div key={v.venueUuid} className="w-[300px] shrink-0">
                <SearchResultCard data={v} />
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
