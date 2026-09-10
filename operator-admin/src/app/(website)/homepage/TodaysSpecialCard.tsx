"use client";

import Link from "next/link";
import type { WebsiteDailySpecialListItem } from "@/lib/data/dailySpecials";
import { OFFER_TYPE_LABELS, type OfferType } from "@/lib/dailySpecialTypes";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import { formatDailySpecialSchedule, formatDailySpecialTime } from "../dailySpecialConsumerLabels";
import { fireDiscoveryClick, type DiscoveryContext } from "@/app/(website)/discoveryTracking";

type Props = {
  special: WebsiteDailySpecialListItem;
  /**
   * Opt-in venue discovery attribution (see discoveryTracking.tsx) —
   * attributes the click to this Special's VENUE, using the exact same
   * venue_id-keyed venue_discover_events infrastructure every other
   * homepage rail/feature already uses. This cannot distinguish which
   * Special on that venue was clicked (the schema has no Special id
   * column) — see this feature's CPanel-integration report for what a
   * real per-Special attribution column would require.
   */
  discovery?: DiscoveryContext;
};

/**
 * Grid-card version of the Today's Specials homepage card (visual
 * refinement — the section moved from a horizontal rail to a 3×2/2×3/1×6
 * grid, so this card no longer needs rail-width density). Slightly more
 * compact than the full /website-daily-specials results-page card
 * (DailySpecialSearchCard.tsx) — same visual language (white card, amber
 * top accent, amber offer-type badge, blue venue name, amber schedule/time
 * line) — but closer to it in size now that a grid column gives each card
 * real room, rather than the earlier narrow rail sizing.
 * `h-full` + an `mt-auto`-pushed footer let the schedule/"View special"
 * block settle toward the bottom of the card without a fixed height, so
 * a grid row's cards line up cleanly regardless of summary length.
 *
 * Final consumer polish pass: the top accent is a shade darker and 1px
 * thicker (amber-600, 5px — was amber-500, 4px) and "View special →" moved
 * from text-xs/amber-600 to text-sm/amber-700, both purely to read more
 * clearly in the browser per manual visual review — still the same amber
 * family already used on DailySpecialSearchCard.tsx, still restrained
 * relative to the title/venue above it.
 *
 * Links to the exact same destination DailySpecialSearchCard.tsx does:
 * the venue's canonical public path + #daily-special-<uuid> anchor — no
 * new destination invented for the homepage.
 */
export function TodaysSpecialCard({ special, discovery }: Props) {
  const venuePath = buildVenuePublicPath({
    marketSlug: special.marketSlug,
    citySlug: special.citySlug,
    slug: special.venueSlug,
  });
  const href = venuePath ? `${venuePath}#daily-special-${special.id}` : null;

  const offerLabel = OFFER_TYPE_LABELS[special.offerType as OfferType] ?? special.offerType;
  const scheduleLabel = formatDailySpecialSchedule(special.schedule);
  const timeLabel = formatDailySpecialTime(special.time);
  const scheduleTimeLine = [scheduleLabel, timeLabel].filter(Boolean).join(" · ");

  const cardBody = (
    <article
      className="
        h-full flex flex-col overflow-hidden
        bg-white rounded-2xl
        border border-gray-100
        shadow-[0_1px_3px_rgba(0,0,0,0.05)]
        hover:shadow-[0_4px_18px_rgba(0,0,0,0.09)]
        hover:-translate-y-[2px]
        transition-all duration-200
      "
    >
      <div className="h-[5px] bg-amber-600" aria-hidden="true" />
      <div className="flex flex-col flex-1 px-5 py-5 space-y-2">
        {offerLabel && (
          <span className="inline-flex items-center self-start px-2.5 py-1 rounded-full bg-amber-50 border border-amber-100 text-[11px] font-semibold text-amber-700 tracking-wide uppercase">
            {offerLabel}
          </span>
        )}

        <h3 className="text-[17px] font-bold text-gray-900 leading-snug tracking-tight line-clamp-2">
          {special.title}
        </h3>

        {special.venueName && (
          <p className="text-sm font-semibold text-blue-600 leading-tight">{special.venueName}</p>
        )}

        {special.shortSummary && (
          <p className="text-sm text-gray-500 leading-relaxed line-clamp-2">{special.shortSummary}</p>
        )}

        {/* Pushed to the bottom of the card via mt-auto (flex-col parent
            above) rather than a fixed card height — a short summary leaves
            more gap here, a long one leaves less, but the schedule/cue
            block itself always settles at the same visual baseline across
            a grid row. */}
        <div className="mt-auto pt-1">
          {scheduleTimeLine && (
            <p className="text-sm text-amber-700 font-medium pt-1.5 border-t border-gray-100">{scheduleTimeLine}</p>
          )}
          <p className="text-sm font-semibold text-amber-700 text-right mt-2">View special →</p>
        </div>
      </div>
    </article>
  );

  if (!href) return cardBody;

  return (
    <Link
      href={href}
      className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-2xl"
      onClick={discovery ? () => fireDiscoveryClick(special.venueId, discovery) : undefined}
    >
      {cardBody}
    </Link>
  );
}
