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
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-3 hover:shadow-md transition">
        {event.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.imageUrl}
            alt={event.title}
            className="w-full object-cover rounded-lg mb-3"
            style={{ maxHeight: "140px" }}
          />
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Title — bold, matches .event-title */}
            <p className="font-semibold text-gray-900 text-base leading-snug mb-0.5">
              {event.title}
            </p>
            {/* Venue — blue, matches .event-venue */}
            {event.venueName && (
              <p className="text-sm font-medium text-blue-500 mb-0.5">
                {event.venueName}
              </p>
            )}
            {/* Schedule — gray, matches .event-time */}
            {event.nextOccurrenceLabel && (
              <p className="text-sm text-gray-500">{event.nextOccurrenceLabel}</p>
            )}
            {event.description && (
              <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">
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
