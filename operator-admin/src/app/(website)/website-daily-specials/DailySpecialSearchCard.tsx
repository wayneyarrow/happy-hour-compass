"use client";

import Link from "next/link";
import type { WebsiteDailySpecialListItem } from "@/lib/data/dailySpecials";
import { OFFER_TYPE_LABELS, type OfferType } from "@/lib/dailySpecialTypes";
import { buildVenuePublicPath } from "@/lib/publicVenueUrl";
import { getVenueImageSrc } from "@/lib/venuePlaceholderImage";
import {
  formatDailySpecialSchedule,
  formatDailySpecialTime,
} from "../dailySpecialConsumerLabels";

function DailySpecialImagePlaceholder() {
  return (
    <div className="w-full h-full bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-2 opacity-60">
        <svg
          className="w-10 h-10 text-amber-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12M15.5 8.5a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z"
          />
        </svg>
        <span className="text-[11px] font-semibold text-amber-500 tracking-wide">SPECIAL</span>
      </div>
    </div>
  );
}

type Props = {
  special: WebsiteDailySpecialListItem;
};

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

  const imageSrc =
    special.imageUrl ??
    getVenueImageSrc({
      images: [],
      placeholderImagePath: special.venuePlaceholderImagePath,
      establishmentType: special.venueEstablishmentType,
    });

  const scheduleLabel = formatDailySpecialSchedule(special.schedule);
  const timeLabel = formatDailySpecialTime(special.time);
  const scheduleTimeLine = [scheduleLabel, timeLabel].filter(Boolean).join(" · ");

  const offerLabel =
    OFFER_TYPE_LABELS[special.offerType as OfferType] ?? special.offerType;

  const cardBody = (
    <article
      className="
        relative
        bg-white rounded-2xl overflow-hidden
        border border-gray-100/80
        shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_14px_rgba(0,0,0,0.07)]
        hover:shadow-[0_2px_8px_rgba(0,0,0,0.04),0_14px_34px_rgba(0,0,0,0.10)]
        hover:-translate-y-[3px]
        transition-all duration-200
      "
    >
      {/* ── Hero image ───────────────────────────────────────────────────── */}
      <div className="relative h-[200px] overflow-hidden bg-gray-100">
        {imageSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageSrc} alt="" className="w-full h-full object-cover" />
        ) : (
          <DailySpecialImagePlaceholder />
        )}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "linear-gradient(to bottom, rgba(0,0,0,0.26) 0%, rgba(0,0,0,0) 48%)",
          }}
          aria-hidden="true"
        />
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 space-y-1.5">
        <h3 className="text-[17px] font-bold text-gray-900 leading-tight tracking-tight line-clamp-2">
          {special.title}
        </h3>

        {special.venueName && (
          <p className="text-sm font-semibold text-blue-600 leading-tight">{special.venueName}</p>
        )}

        {special.shortSummary && (
          <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">
            {special.shortSummary}
          </p>
        )}

        {scheduleTimeLine && (
          <p className="text-sm text-amber-700 font-medium">{scheduleTimeLine}</p>
        )}

        {offerLabel && (
          <div className="pt-1.5 border-t border-gray-100">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-100 text-[11px] font-medium text-gray-600">
              {offerLabel}
            </span>
          </div>
        )}
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
