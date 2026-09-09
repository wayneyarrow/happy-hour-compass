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

  // ── Deep-link scroll correction ──────────────────────────────────────────
  // Deliberately keyed on `todayIsoDate`, not `[]` (mount-once) — this is
  // the ONLY point in the component's lifecycle where React GUARANTEES the
  // DOM already reflects the FINAL, today-aware sort order (`ordered`
  // above is derived from `todayIsoDate`, so an effect that depends on it
  // fires strictly after the commit that applied that reorder).
  //
  // Root cause this fixes: before this correction, a separate top-level
  // component (formerly DailySpecialDeepLinkScroll) did its own one-time
  // "scroll the target into view if not already visible" check on ITS OWN
  // mount — which, for a venue with more than one Daily Special, ran
  // BEFORE this section's own today-aware re-sort had happened (this
  // section renders in the server's `created_at` insertion order until
  // mount, then re-sorts). Any correct scroll position computed against
  // the PRE-sort layout was invalidated the instant the re-sort reflowed
  // the surrounding cards a moment later — the viewport ended up aligned
  // with whichever Special happened to land at that Y position after
  // reordering, not the one actually clicked. This was invisible during
  // Phase 3 QA (a single synthetic Special can't reorder relative to
  // itself) and only surfaced once real venues had multiple Specials.
  //
  // Fix: do the scroll correction here instead, once, after this
  // component's own reorder has already committed — deterministic (real
  // effect-dependency ordering, not a guessed timeout), and correct
  // regardless of list length (a 1-item list reorders to itself, so this
  // is a safe no-op there too).
  useEffect(() => {
    if (!todayIsoDate) return;
    const hash = window.location.hash;
    if (!hash.startsWith("#daily-special-")) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "auto", block: "start" });
  }, [todayIsoDate]);

  // Exact-target visual highlight (visual polish pass): uses Tailwind's
  // `target:` variant — plain CSS `:target`, matched against THIS element's
  // own `id` and the current URL hash — deliberately not new React state.
  // `:target` is inherently exclusive (a URL fragment can only ever match
  // one element's id), so at most one card is ever highlighted, and it
  // works identically for a click from search, a pasted URL, and a
  // hash-intact refresh, with zero additional JS: no listener, no timer,
  // no re-render. It coexists with, and is fully independent of, the
  // scroll-correction effect above and StickyNav's separate active-section
  // logic — none of that JS-driven behavior changes.
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
            className="
              p-5 rounded-xl border border-gray-100 bg-gray-50/60
              transition-colors duration-300
              target:border-amber-300 target:bg-amber-50/70
              target:ring-2 target:ring-amber-300/70
              target:shadow-[0_4px_16px_rgba(217,119,6,0.15)]
            "
          >
            <div className="min-w-0">
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
