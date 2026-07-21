"use client";

import { useState } from "react";
import { AcquisitionModal } from "@/app/(website)/acquisition/AcquisitionModal";
import { AddVenueModalContent } from "@/app/(website)/acquisition/AddVenueModalContent";

/**
 * Inline "wrong path" prompt for Step 1 of the claim journey, shown right at
 * the point an operator is searching for their venue. Distinct from
 * AddVenueFallback (the existing prompt near the bottom of the page) both in
 * copy — "Don't see your venue?" fits the in-the-moment search context,
 * vs. the bottom prompt's more general "if your venue isn't listed yet" —
 * and in styling (left-aligned, sized to sit under a step description
 * rather than centered under a page-level CTA). Kept as its own component
 * rather than a variant of AddVenueFallback so neither call site's copy or
 * layout assumptions leak into the other.
 *
 * Reuses AcquisitionModal + AddVenueModalContent exactly as every other
 * "Add Your Venue" entry point already does — no new form, no claim logic
 * duplicated.
 */
export function AddVenueStepPrompt() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <p className="mt-3 text-sm text-gray-400">
        Don&rsquo;t see your venue?{" "}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium text-gray-600 underline underline-offset-2 hover:text-gray-800 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          Add your venue instead.
        </button>
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
