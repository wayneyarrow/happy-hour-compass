"use client";

import type { ConsumerVenue } from "@/lib/data/venues";
import { VenueList } from "../../../VenueList";
import { CollectionHeader } from "./CollectionHeader";

type Props = {
  title: string;
  venues: ConsumerVenue[];
};

export function CollectionVenueView({ title, venues }: Props) {
  return (
    <>
      <CollectionHeader title={title} />

      {/* Venue list — reuses existing VenueList (geo-sorts + open-status) */}
      <div style={{ paddingBottom: 110 }}>
        {venues.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              padding: "64px 40px",
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
              No venues here yet
            </p>
            <p style={{ fontSize: 14, color: "#9ca3af" }}>
              Check back soon.
            </p>
          </div>
        ) : (
          <VenueList venues={venues} />
        )}
      </div>
    </>
  );
}
