import type { PublicCollectionModel } from "@/lib/data/collectionPublic";

/**
 * Type-specific Collection Landing Page content — the clean boundary future
 * tasks build beneath the shared shell (CollectionLandingShell.tsx):
 *   - VenueCollectionContent  -> Venue results/map presentation
 *   - EventCollectionContent  -> Event results/map presentation
 *   - GuideCollectionContent  -> Guide editorial layout
 *
 * This task builds shared infrastructure only — every branch intentionally
 * renders nothing yet (no "Coming Soon" copy, no placeholder cards, so the
 * empty region takes up zero visible space). Each branch is already a real,
 * named, correctly-typed component so a future task can build its
 * presentation in complete isolation, without touching the shell, the
 * route, or the other two branches.
 */

type Props = {
  model: PublicCollectionModel;
};

export function CollectionTypeContent({ model }: Props) {
  switch (model.kind) {
    case "venue":
      return <VenueCollectionContent model={model} />;
    case "event":
      return <EventCollectionContent model={model} />;
    case "guide":
      return <GuideCollectionContent model={model} />;
  }
}

function VenueCollectionContent({ model }: { model: Extract<PublicCollectionModel, { kind: "venue" }> }) {
  // Venue results/map presentation — future task. `model.items` is already
  // public-safe ConsumerVenue[] in final resolved order, ready to consume.
  void model;
  return null;
}

function EventCollectionContent({ model }: { model: Extract<PublicCollectionModel, { kind: "event" }> }) {
  // Event results/map presentation — future task. `model.items` is already
  // public-safe WebsiteEventListItem[] in final resolved order, ready to consume.
  void model;
  return null;
}

function GuideCollectionContent({ model }: { model: Extract<PublicCollectionModel, { kind: "guide" }> }) {
  // Guide editorial layout — future task. `model.items` is already
  // public-safe SavedGuideCard[] in final resolved order, ready to consume.
  void model;
  return null;
}
