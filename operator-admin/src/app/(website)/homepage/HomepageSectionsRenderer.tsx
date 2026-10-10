import { CollectionRail } from "./CollectionRail";
import { FeatureSection } from "./FeatureSection";
import { TodaysSpecialsSection } from "./TodaysSpecialsSection";
import type { HomepagePreviewSection } from "@/lib/data/homepagePreview";
import { DiscoveryPlacement } from "../tracking/DiscoveryTrackingProvider";

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

/**
 * Each Section is its own discovery-tracking placement (website_discovery_events,
 * migration 110). Tracking only actually records when an ancestor
 * <DiscoveryPageTracking> exists — the live public homepage ((website)/page.tsx)
 * provides one; the Control Panel's homepage preview route
 * (control-panel/homepages/[id]/preview) does not, so previewing a draft
 * Homepage never generates real events.
 */
export function HomepageSectionsRenderer({ sections }: Props) {
  return (
    <>
      {sections.map((section) => (
        <DiscoveryPlacement key={section.id} surface="homepage_section" sectionId={section.id} sectionKind={section.kind}>
          {renderSection(section)}
        </DiscoveryPlacement>
      ))}
    </>
  );
}

function renderSection(section: HomepagePreviewSection) {
  if (section.kind === "venue_collection" || section.kind === "event_collection" || section.kind === "guide_collection") {
    return <CollectionRail section={section} />;
  }
  if (section.kind === "daily_special_collection") {
    return <TodaysSpecialsSection section={section} />;
  }
  return <FeatureSection section={section} />;
}
