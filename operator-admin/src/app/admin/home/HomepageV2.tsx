import Link from "next/link";
import type { SuggestionCard } from "@/lib/suggestedSteps";
import type { VenueCompletion } from "@/lib/venueCompletion";
import V2IntroBanner from "./V2IntroBanner";
import VenueHealthModule from "./modules/VenueHealthModule";
import SuggestedNextStepsModule from "./modules/SuggestedNextStepsModule";
import QuickActionsModule from "./modules/QuickActionsModule";
import VenueSnapshotModule from "./modules/VenueSnapshotModule";
import IndustryReadsModule from "./modules/IndustryReadsModule";
import HelpModule from "./modules/HelpModule";

type Props = {
  venueName: string;
  venueSlug: string | null;
  venueId: string;
  /** True when the operator has already dismissed the intro banner (DB-persisted). */
  introSeen: boolean;
  suggestions: SuggestionCard[];
  isPublished: boolean;
  isClaimed: boolean;
  completion: VenueCompletion;
  updatedAt: string | null;
};

export default function HomepageV2({
  venueName,
  venueSlug,
  venueId,
  introSeen,
  suggestions,
  isPublished,
  isClaimed,
  completion,
  updatedAt,
}: Props) {
  const publicHref = `/venue/${venueSlug ?? venueId}?preview=true`;

  return (
    <div className="max-w-3xl">
      {/* One-time intro banner — server decides whether to mount based on DB state */}
      {!introSeen && <V2IntroBanner />}

      {/* Page heading */}
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-900">Venue HQ</h2>
        <p className="text-sm text-gray-500 mt-1">Grow and improve your venue.</p>
      </div>

      {/* Venue status strip */}
      <div className="mb-5 bg-white rounded-xl border border-gray-200 px-5 py-3.5 flex items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold text-gray-900 truncate">{venueName}</span>
          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
            Live
          </span>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <a
            href={publicHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-amber-700 hover:text-amber-800 transition-colors"
          >
            Preview →
          </a>
          <Link
            href="/admin/venue"
            className="text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            Edit venue →
          </Link>
        </div>
      </div>

      {/* Module grid
          SuggestedNextSteps and VenueSnapshot span full width (md:col-span-2).
          The rest fill the 2-column grid naturally on desktop. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SuggestedNextStepsModule suggestions={suggestions} />
        <VenueHealthModule
          isPublished={isPublished}
          isClaimed={isClaimed}
          completion={completion}
          updatedAt={updatedAt}
        />
        <QuickActionsModule />
        <VenueSnapshotModule />
        <IndustryReadsModule />
        <HelpModule />
      </div>
    </div>
  );
}
