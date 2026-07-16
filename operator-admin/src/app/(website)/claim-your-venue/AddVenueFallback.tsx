"use client";

import { useState } from "react";
import { AcquisitionModal } from "@/app/(website)/acquisition/AcquisitionModal";
import { AddVenueModalContent } from "@/app/(website)/acquisition/AddVenueModalContent";

/**
 * Secondary "add it instead" path beneath the Find My Venue CTA. Reuses
 * AcquisitionModal + AddVenueModalContent exactly as the header, footer, and
 * every other acquisition entry point already do — no new form, no claim
 * logic duplicated. Kept as its own small client component so page.tsx
 * stays a plain server component, same split used throughout /business and
 * the rest of this page.
 */
export function AddVenueFallback() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <p className="mt-6 text-center text-sm text-gray-500">
        If your venue isn&rsquo;t listed yet,{" "}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          add it instead
        </button>
        .
      </p>

      <AcquisitionModal
        open={open}
        onClose={() => setOpen(false)}
        title="Add Your Venue"
        description="List your restaurant or bar on Happy Hour Compass and reach people looking for great happy hours."
      >
        <AddVenueModalContent onDone={() => setOpen(false)} />
      </AcquisitionModal>
    </>
  );
}
