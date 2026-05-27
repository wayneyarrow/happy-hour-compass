import Link from "next/link";
import type { SuggestionCard } from "@/lib/suggestedSteps";
import type { VenueCompletion } from "@/lib/venueCompletion";
import V2IntroBanner from "./V2IntroBanner";
import VenueHealthModule from "./modules/VenueHealthModule";
import SuggestedNextStepsModule from "./modules/SuggestedNextStepsModule";
import QuickActionsModule from "./modules/QuickActionsModule";
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

      {/* ── Identity block ──────────────────────────────────────────────────────
          Warm amber wash anchors the page. The venue name is the primary heading —
          "Venue HQ" is the eyebrow label. On V2 the venue is always live, so the
          Live badge is removed; the focus shifts to venue identity and momentum. */}
      <div className="mb-6 rounded-2xl bg-gradient-to-b from-amber-50 to-orange-50/30 border border-amber-100 px-5 py-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-2">
          Venue HQ
        </p>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold text-gray-900 leading-tight truncate">{venueName}</h2>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed">
              Your venue is live — keep your listing sharp and your tables full.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0 mt-0.5">
            <a
              href={publicHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-amber-700 hover:text-amber-800 transition-colors"
            >
              View listing ↗
            </a>
            <Link
              href="/admin/venue"
              className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
            >
              Edit venue →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Module grid ─────────────────────────────────────────────────────────
          SuggestedNextSteps spans full width (md:col-span-2).
          Remaining modules fill the 2-column grid naturally on desktop. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SuggestedNextStepsModule suggestions={suggestions} />
        <VenueHealthModule
          isPublished={isPublished}
          isClaimed={isClaimed}
          completion={completion}
          updatedAt={updatedAt}
        />
        <QuickActionsModule venueSlug={venueSlug} venueId={venueId} />
        <IndustryReadsModule />
        <HelpModule />
      </div>
    </div>
  );
}
