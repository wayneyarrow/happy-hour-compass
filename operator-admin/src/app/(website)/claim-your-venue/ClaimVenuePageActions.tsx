"use client";

import { useState } from "react";
import { AcquisitionModal } from "@/app/(website)/acquisition/AcquisitionModal";
import { AddVenueModalContent } from "@/app/(website)/acquisition/AddVenueModalContent";

/**
 * The page's one piece of client interactivity — the secondary "Add it
 * here" path for a venue that isn't listed yet. Reuses AddVenueModalContent
 * exactly as the header and footer already do; no new form, no claim logic
 * duplicated. Kept as a small standalone client component so page.tsx
 * itself can stay a plain server component.
 */
export function ClaimVenuePageActions() {
  const [addVenueOpen, setAddVenueOpen] = useState(false);

  return (
    <>
      <p className="mt-6 text-sm text-gray-500">
        Can&rsquo;t find your venue?{" "}
        <button
          type="button"
          onClick={() => setAddVenueOpen(true)}
          className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          Add it here.
        </button>
      </p>

      <AcquisitionModal
        open={addVenueOpen}
        onClose={() => setAddVenueOpen(false)}
        title="Add Your Venue"
        description="List your restaurant or bar on Happy Hour Compass and reach people looking for great happy hours."
      >
        <AddVenueModalContent onDone={() => setAddVenueOpen(false)} />
      </AcquisitionModal>
    </>
  );
}
