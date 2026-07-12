import { CollectionRail } from "./CollectionRail";
import { FeatureSection } from "./FeatureSection";
import type { HomepagePreviewSection } from "@/lib/data/homepagePreview";

/**
 * Renders the Dynamic Editorial Homepage sections beneath the Discovery
 * Shell, in saved order. `sections` is already filtered upstream
 * (homepagePreview.ts) to only the ones that resolved to usable content —
 * this component does no eligibility/empty-state logic of its own, it just
 * maps Section kind -> rendering component.
 *
 * This is the reusable "public-style Homepage renderer" the Build Homepage
 * Preview task asks for: it takes no preview-only props (no banner, no
 * status badge) and lives under (website)/, so a future public Homepage
 * route can render the exact same component the Control Panel preview does.
 */

type Props = {
  sections: HomepagePreviewSection[];
};

export function HomepageSectionsRenderer({ sections }: Props) {
  return (
    <>
      {sections.map((section) => {
        if (section.kind === "venue_collection" || section.kind === "event_collection" || section.kind === "guide_collection") {
          return <CollectionRail key={section.id} section={section} />;
        }
        return <FeatureSection key={section.id} section={section} />;
      })}
    </>
  );
}
