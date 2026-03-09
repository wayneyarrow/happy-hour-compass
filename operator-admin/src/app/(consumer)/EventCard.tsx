"use client";

import Link from "next/link";
import type { ConsumerEventListItem } from "@/lib/data/events";
import { EventBookmarkButton } from "./EventBookmarkButton";

type Props = {
  event: ConsumerEventListItem;
};

/**
 * Single event card — extracted from EventsDiscovery so it can be reused
 * on the Saved page.
 *
 * Card style matches original .event-item from index.html.
 * Uses EventBookmarkButton to save/unsave the event by ID (savedEvents key).
 */
export function EventCard({ event }: Props) {
  return (
    <Link href={`/event/${event.id}`}>
      <div className="bg-white rounded-lg p-[14px] mb-px border-b border-gray-100 hover:bg-[#fafbfc] transition-colors cursor-pointer">
        {event.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.imageUrl}
            alt={event.title}
            className="w-full object-cover rounded mb-3"
            style={{ maxHeight: "140px" }}
          />
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Title — matches .event-title: 700 weight, 17px, line-height 1.2 */}
            <p className="font-bold text-[17px] text-gray-900 leading-[1.2] mb-1">
              {event.title}
            </p>
            {/* Venue — matches .event-venue: blue-500, 14px, medium */}
            {event.venueName && (
              <p className="text-sm font-medium text-blue-500 mb-0.5">
                {event.venueName}
              </p>
            )}
            {/* Schedule — matches .event-time: 13px, gray-500 */}
            {event.nextOccurrenceLabel && (
              <p className="text-[13px] text-gray-500">{event.nextOccurrenceLabel}</p>
            )}
            {event.description && (
              <p className="text-[13px] text-gray-500 mt-1.5 line-clamp-2">
                {event.description}
              </p>
            )}
          </div>
          <EventBookmarkButton eventId={event.id} />
        </div>
      </div>
    </Link>
  );
}
