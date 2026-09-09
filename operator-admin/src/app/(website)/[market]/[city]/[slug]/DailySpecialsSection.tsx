"use client";

import { useEffect, useState } from "react";
import { occursOnDate } from "@/lib/dailySpecialSchedule";
import { OFFER_TYPE_LABELS, type OfferType, type DailySpecial } from "@/lib/dailySpecialTypes";
import {
  formatDailySpecialTime,
  scheduleSummaryForContext,
} from "../../../dailySpecialConsumerLabels";
import { sortDailySpecialsForVenueDetail } from "./dailySpecialsOrder";

type Props = {
  specials: DailySpecial[];
  scrollMargin: number;
};

/** "YYYY-MM-DD" for the viewer's browser-local today. */
function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Extra headroom (on top of the shared section `scrollMargin`) reserved
 * above an individual Daily Special anchor specifically — deliberately
 * MORE than the section's own scroll-margin, not the same value.
 *
 * Deep-link arrival correction: landing on a Special via its exact
 * `#daily-special-<uuid>` anchor with only the shared section margin put
 * the card's top flush against the sticky nav, which scrolled the "Daily
 * Specials" heading (rendered above this component, in page.tsx) entirely
 * out of view — a visitor arrived with no section context at all, just an
 * isolated card. This constant is a fixed, position-independent buffer
 * (not computed from where the heading happens to be), so it works
 * identically for the first Special in a short list (revealing the
 * section heading above it, the common case today) and for the Nth
 * Special in a future long list (revealing a bit of the preceding card as
 * leading context instead — never force-scrolling all the way back to the
 * heading, which could hide the actual clicked Special several cards down).
 * ~64px comfortably fits the "Daily Specials" <h2> (text-2xl, mb-5) used
 * in page.tsx without needing to measure it at runtime.
 */
const DAILY_SPECIAL_ITEM_CONTEXT_OFFSET = 64;

/**
 * Flat card list, not grouped-by-day sections — a multi-weekday Special
 * (e.g. Monday-Friday) stays exactly one card with a clear schedule label,
 * rather than being duplicated across five day groups or forcing a
 * grouped-by-day layout to awkwardly special-case it. This is the
 * "prefer a clean flat/card list with prominent schedule labels" fallback
 * the Phase 3 task brief explicitly sanctions when grouped-by-day would be
 * awkward for multi-day content.
 *
 * "use client" + mount-gated today computation for the exact same reason
 * as EventSearchCard.tsx's DateBadge: computing "is this valid today" (and
 * therefore the display order/Today badges) during SSR would use the
 * server's own timezone (UTC on the deployment host), not the viewer's —
 * producing a wrong-by-several-hours answer and a React hydration
 * mismatch if rendered directly. Before mount, this renders in a stable,
 * day-independent order (input order — already title-sorted by the
 * server query) with no "Today" badges — identical on server and first
 * client render — then re-sorts with the real local date once mounted.
 */
export function DailySpecialsSection({ specials, scrollMargin }: Props) {
  const [todayIsoDate, setTodayIsoDate] = useState<string | null>(null);

  useEffect(() => {
    setTodayIsoDate(todayIsoLocal());
  }, []);

  const ordered = todayIsoDate ? sortDailySpecialsForVenueDetail(specials, todayIsoDate) : specials;

  return (
    <div className="space-y-4">
      {ordered.map((special) => {
        const isToday = todayIsoDate ? occursOnDate(special.schedule, todayIsoDate) : false;
        const scheduleLabel = scheduleSummaryForContext(
          special.schedule,
          isToday ? "today" : "browse"
        );
        const timeLabel = formatDailySpecialTime(special.time);
        const offerLabel = OFFER_TYPE_LABELS[special.offerType as OfferType] ?? special.offerType;

        return (
          <div
            key={special.id}
            id={`daily-special-${special.id}`}
            style={{ scrollMarginTop: scrollMargin + DAILY_SPECIAL_ITEM_CONTEXT_OFFSET }}
            className="flex items-start gap-4 p-5 rounded-xl border border-gray-100 bg-gray-50/60"
          >
            {special.imageUrl && (
              <div className="hidden sm:block shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={special.imageUrl} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-gray-900 leading-snug text-[15px]">
                  {special.title}
                </h3>
                {isToday && (
                  <span className="shrink-0 text-[11px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                    Today
                  </span>
                )}
              </div>

              <p className="text-sm text-amber-700 font-medium mt-0.5">
                {[scheduleLabel, timeLabel].filter(Boolean).join(" · ")}
              </p>

              {special.shortSummary && (
                <p className="text-sm text-gray-700 mt-1.5 leading-snug">{special.shortSummary}</p>
              )}

              {special.description && (
                <p className="text-sm text-gray-500 mt-1 leading-snug">{special.description}</p>
              )}

              {special.conditions && (
                <p className="text-xs text-gray-400 mt-1.5 italic">{special.conditions}</p>
              )}

              <div className="mt-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white border border-gray-200 text-[11px] font-medium text-gray-500">
                  {offerLabel}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
