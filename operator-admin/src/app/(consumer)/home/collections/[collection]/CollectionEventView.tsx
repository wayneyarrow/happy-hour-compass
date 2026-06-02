"use client";

import type { ConsumerEventListItem } from "@/lib/data/events";
import { EventCard } from "../../../EventCard";
import { CollectionHeader } from "./CollectionHeader";

type Props = {
  title: string;
  events: ConsumerEventListItem[];
};

export function CollectionEventView({ title, events }: Props) {
  return (
    <>
      <CollectionHeader title={title} />

      {/* Event list — reuses existing EventCard; no filter/search chrome */}
      <div style={{ padding: "0 20px 110px" }}>
        {events.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              padding: "64px 0",
            }}
          >
            <p
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "#374151",
                marginBottom: 8,
              }}
            >
              No events yet
            </p>
            <p style={{ fontSize: 14, color: "#9ca3af" }}>
              Check back soon for upcoming events.
            </p>
          </div>
        ) : (
          <ul className="[&>li]:block">
            {events.map((event) => (
              <li key={event.id}>
                <EventCard event={event} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
