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
    <Link href={`/event/${event.id}`} className="block">
      <div
        className="bg-white rounded-2xl p-4 cursor-pointer transition-all duration-150 hover:shadow-[0_4px_14px_rgba(0,0,0,0.11)]"
        style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.07)", border: "1px solid #efefef" }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Title */}
            <p className="font-bold text-[17px] text-gray-900 leading-[1.2] mb-1">
              {event.title}
            </p>
            {/* Venue */}
            {event.venueName && (
              <p className="text-[13px] font-semibold text-blue-500 mb-1">
                {event.venueName}
              </p>
            )}
            {/* Schedule */}
            {event.nextOccurrenceLabel && (
              <p className="text-[12px] text-gray-400 font-medium">{event.nextOccurrenceLabel}</p>
            )}
          </div>
          <EventBookmarkButton eventId={event.id} />
        </div>
      </div>
    </Link>
  );
}
