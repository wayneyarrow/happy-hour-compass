"use client";

import Link from "next/link";
import type { WebsiteDailySpecialListItem } from "@/lib/data/dailySpecials";
import { OFFER_TYPE_LABELS, type OfferType } from "@/lib/dailySpecialTypes";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import {
  formatDailySpecialSchedule,
  formatDailySpecialTime,
} from "../dailySpecialConsumerLabels";

type Props = {
  special: WebsiteDailySpecialListItem;
};

/**
 * Text-first by product decision (correction task): Daily Specials cards
 * never render an image, whether the Special's own image field or the
 * venue's own fallback photo. Real seeded inventory showed the venue
 * fallback routinely misrepresenting the actual offer (a wine Special
 * showing a beer-pour photo, a taco Special showing a generic bar
 * interior) — genuinely misleading, not just a missing-asset placeholder
 * problem. `image_url` itself is untouched at the data layer (schema,
 * WebsiteDailySpecialListItem, the server query) — this component simply
 * never reads it. If Special-specific imagery is reintroduced later, it
 * should be a deliberate product decision with real, always-accurate
 * per-Special photography — not a venue-photo stand-in.
 *
 * Visual polish pass (this task): the image-free grid read as flat/
 * directory-like, so a thin HHC-brand (amber-500 — the same accent used
 * for the active StickyNav underline, primary buttons, and focus rings
 * throughout the site, not a new color) top accent line, a touch more
 * resting depth, and a restrained hover lift were added — no product
 * architecture, data, or information changed. Deliberately does NOT use
 * a `motion-safe:`/reduced-motion-gated transform: no existing card on
 * this site (EventSearchCard, website-happy-hours' SearchResultCard, the
 * pre-polish version of this one) gates its own hover lift that way
 * either — introducing it here alone would be a new, inconsistent
 * convention rather than following an existing one, which is what the
 * task asked for.
 */
export function DailySpecialSearchCard({ special }: Props) {
  // Venue detail page + exact anchor — no standalone Daily Special page
  // exists (locked product decision). Falls back to null (no link) only
  // when the venue has no resolvable canonical URL yet — same permissive
  // convention as buildEventPublicPath's own null-handling elsewhere;
  // there is no UUID-compatibility fallback route for a venue the way
  // there is for events, since /venue/[id] is a (consumer)-app route, not
  // a (website) one.
  const venuePath = buildVenuePublicPath({
    marketSlug: special.marketSlug,
    citySlug: special.citySlug,
    slug: special.venueSlug,
  });
  const href = venuePath ? `${venuePath}#daily-special-${special.id}` : null;

  const scheduleLabel = formatDailySpecialSchedule(special.schedule);
  const timeLabel = formatDailySpecialTime(special.time);
  const scheduleTimeLine = [scheduleLabel, timeLabel].filter(Boolean).join(" · ");

  const offerLabel =
    OFFER_TYPE_LABELS[special.offerType as OfferType] ?? special.offerType;

  const cardBody = (
    <article
      className="
        relative overflow-hidden
        bg-white rounded-2xl
        border border-gray-100/80
        shadow-[0_1px_4px_rgba(0,0,0,0.05),0_6px_18px_rgba(0,0,0,0.09)]
        hover:shadow-[0_3px_10px_rgba(0,0,0,0.06),0_16px_32px_rgba(0,0,0,0.11)]
        hover:-translate-y-[2px]
        transition-all duration-200
      "
    >
      {/* Top accent line — thin, brand-consistent (amber-500, same token
          used for the active StickyNav underline and primary buttons
          elsewhere on the site), the one restrained cue that replaces the
          removed hero image and keeps the grid from reading as a flat
          directory list. */}
      <div className="h-1 bg-amber-500" aria-hidden="true" />

      <div className="px-5 py-5 space-y-2">
        {/* Type badge first — small, secondary, sets context before the title
            the way a card image's implicit category cue used to. */}
        {offerLabel && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-100 text-[11px] font-semibold text-amber-700 tracking-wide uppercase">
            {offerLabel}
          </span>
        )}

        <h3 className="text-[19px] font-bold text-gray-900 leading-tight tracking-tight">
          {special.title}
        </h3>

        {special.venueName && (
          <p className="text-sm font-semibold text-blue-600 leading-tight">{special.venueName}</p>
        )}

        {special.shortSummary && (
          <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">
            {special.shortSummary}
          </p>
        )}

        {scheduleTimeLine && (
          <p className="text-sm text-amber-700 font-medium pt-1 border-t border-gray-100 mt-1">
            {scheduleTimeLine}
          </p>
        )}

        {/* Destination cue — purely decorative text, not a second
            interactive element; the whole card is already the one Link.
            Secondary by design (smaller, muted, right-aligned) so it never
            competes with the schedule/time line above it. */}
        <p className="text-xs font-medium text-gray-400 text-right pt-0.5">
          View venue →
        </p>
      </div>
    </article>
  );

  if (!href) {
    // No resolvable venue URL — render statically rather than a dead link.
    return cardBody;
  }

  return (
    <Link
      href={href}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-2xl"
    >
      {cardBody}
    </Link>
  );
}
