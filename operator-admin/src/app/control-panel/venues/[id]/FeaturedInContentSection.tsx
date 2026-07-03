import Link from "next/link";
import StatusBadge, { type StatusVariant } from "@/components/StatusBadge";
import type {
  VenueFeaturedContent,
  VenueFeaturedGuide,
  VenueFeaturedEventGuide,
} from "@/lib/data/contentGuideAttachments";
import type { GuideStatus } from "@/lib/data/contentGuides";

/**
 * Read-only "Featured in Content" section for the Control Panel venue detail
 * page (Card 7B). Shows where this venue shows up in Content Engine guides —
 * directly (Venue Guides) or via one of its events (Event Guides). No
 * editing, no attachment management: every action here is a link out to the
 * Content Engine guide editor. See src/lib/data/contentGuideAttachments.ts
 * (getVenueFeaturedContent) for the read.
 */

const STATUS_VARIANT: Record<GuideStatus, StatusVariant> = {
  draft: "neutral",
  published: "success",
};

const STATUS_LABELS: Record<GuideStatus, string> = {
  draft: "Draft",
  published: "Published",
};

function locationLabel(marketName: string | null, cityName: string | null): string | null {
  if (marketName && cityName) return `${cityName}, ${marketName}`;
  return marketName ?? cityName ?? null;
}

function GuideRow({
  guide,
  eventLabel,
}: {
  guide: VenueFeaturedGuide;
  eventLabel?: string;
}) {
  const location = locationLabel(guide.marketName, guide.cityName);

  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <Link
          href={`/control-panel/content-engine/${guide.guideId}/edit`}
          className="text-sm font-medium text-gray-900 hover:text-amber-600 transition-colors"
        >
          {guide.title}
        </Link>
        {eventLabel && <p className="text-xs text-gray-500 mt-0.5">{eventLabel}</p>}
        {location && <p className="text-xs text-gray-400 mt-0.5">{location}</p>}
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <StatusBadge variant={STATUS_VARIANT[guide.status]} label={STATUS_LABELS[guide.status]} />
        <Link
          href={`/control-panel/content-engine/${guide.guideId}/edit`}
          className="text-xs font-medium text-amber-600 hover:text-amber-700 whitespace-nowrap"
        >
          Edit →
        </Link>
      </div>
    </li>
  );
}

function eventGuideLabel(guide: VenueFeaturedEventGuide): string | undefined {
  if (guide.eventTitles.length === 0) return undefined;
  const noun = guide.eventTitles.length === 1 ? "Event" : "Events";
  return `${noun}: ${guide.eventTitles.join(", ")}`;
}

export default function FeaturedInContentSection({ data }: { data: VenueFeaturedContent }) {
  const { venueGuides, eventGuides } = data;
  const isEmpty = venueGuides.length === 0 && eventGuides.length === 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6">
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
        Featured in Content
      </h2>

      {isEmpty ? (
        <p className="text-sm text-gray-400 italic">
          This venue is not currently featured in any guides.
        </p>
      ) : (
        <div className="space-y-5">
          {venueGuides.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Venue Guides
              </h3>
              <ul className="divide-y divide-gray-100">
                {venueGuides.map((guide) => (
                  <GuideRow key={guide.guideId} guide={guide} />
                ))}
              </ul>
            </div>
          )}

          {eventGuides.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Event Guides
              </h3>
              <ul className="divide-y divide-gray-100">
                {eventGuides.map((guide) => (
                  <GuideRow key={guide.guideId} guide={guide} eventLabel={eventGuideLabel(guide)} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
