import {
  getPublishedDailySpecialsForWebsite,
  type WebsiteDailySpecialListItem,
} from "@/lib/data/dailySpecials";
import { dailySpecialMatchesSearch } from "@/lib/dailySpecialSchedule";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import type { Market } from "@/lib/markets";
import { formatDailySpecialSchedule, formatDailySpecialTime } from "./dailySpecialConsumerLabels";

/**
 * Homepage Daily Specials-mode autocomplete — the Daily Specials equivalent
 * of venueSuggestions.ts. Lives under (website)/ (not src/lib/data/, where
 * venueSuggestions.ts lives) specifically so it can reuse
 * dailySpecialConsumerLabels.ts's consumer-facing schedule/time formatting
 * — that file is deliberately website-presentation-scoped (see its own
 * header comment), so a shared-engine module under src/lib/ must not
 * depend on it; this module can, since it lives in the same presentation
 * layer.
 *
 * Matching itself is delegated entirely to dailySpecialMatchesSearch()
 * (src/lib/dailySpecialSchedule.ts) — the exact same title/short_summary/
 * description matcher the /website-daily-specials `?q=` results page uses
 * (DailySpecialSearchResults.tsx) — so "wine" matches a Special whose own
 * content mentions wine, never a venue whose Happy Hour happens to.
 *
 * Eligibility is inherited unmodified from getPublishedDailySpecialsForWebsite()
 * (published Special + published venue + active-market scoping) — no
 * separate/duplicate eligibility rule is introduced here.
 */

export type DailySpecialSuggestion = {
  id: string;
  title: string;
  venueName: string;
  /** Short summary when authored, else a compact schedule/time line (e.g. "Every Wednesday · 4-9 PM") — same fallback the full results card uses. */
  contextLabel: string;
  /** Venue's canonical public URL + the exact Special's anchor — same destination DailySpecialSearchCard.tsx links to. */
  href: string;
};

const DEFAULT_SUGGESTION_LIMIT = 8;

/** Pure — builds one suggestion from an already-fetched, already-eligible Special. Returns null only when the venue has no resolvable canonical URL yet (see buildVenuePublicPath). */
export function toDailySpecialSuggestion(special: WebsiteDailySpecialListItem): DailySpecialSuggestion | null {
  const venuePath = buildVenuePublicPath({
    marketSlug: special.marketSlug,
    citySlug: special.citySlug,
    slug: special.venueSlug,
  });
  if (!venuePath) return null;

  const scheduleLabel = formatDailySpecialSchedule(special.schedule);
  const timeLabel = formatDailySpecialTime(special.time);
  const scheduleTimeLine = [scheduleLabel, timeLabel].filter(Boolean).join(" · ");
  const contextLabel = special.shortSummary?.trim() || scheduleTimeLine;

  return {
    id: special.id,
    title: special.title,
    venueName: special.venueName,
    contextLabel,
    href: `${venuePath}#daily-special-${special.id}`,
  };
}

/**
 * Searches published, in-market Daily Specials by title/short_summary/
 * description. getPublishedDailySpecialsForWebsite() already applies the
 * market-radius gate (haversineKm against `market`) before returning, so
 * this doesn't repeat that filter — same division of responsibility as
 * DailySpecialSearchResults.tsx, which also only text-filters an
 * already-market-scoped list.
 */
export async function searchDailySpecialSuggestions(
  market: Market,
  rawQuery: string,
  limit: number = DEFAULT_SUGGESTION_LIMIT
): Promise<DailySpecialSuggestion[]> {
  if (!rawQuery.trim()) return [];

  const specials = await getPublishedDailySpecialsForWebsite(market);
  const matched = specials.filter((s) =>
    dailySpecialMatchesSearch(
      { title: s.title, shortSummary: s.shortSummary, description: s.description },
      rawQuery
    )
  );

  return matched.slice(0, limit).flatMap((s) => {
    const suggestion = toDailySpecialSuggestion(s);
    return suggestion ? [suggestion] : [];
  });
}
