"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { AcquisitionModal } from "../acquisition/AcquisitionModal";
import { AddVenueModalContent } from "../acquisition/AddVenueModalContent";

/**
 * "List Your Venue Free" call to action — a small client island that opens
 * the existing venue-submission flow (AcquisitionModal + AddVenueModalContent,
 * the same flow WebsiteHeader's "Add Your Venue" and the footer's
 * "Add Your Venue" already use). Reused for both the hero and final CTA on
 * the business page, and intended for reuse on future business pages
 * (Pricing, etc.) — see the Business Funnel Blueprint's CTA Label Glossary.
 *
 * Deliberately self-contained (owns its own modal instance) rather than
 * requiring a shared context, so it can be dropped in anywhere on the page
 * without coordinating state with other instances.
 */

type Props = {
  className: string;
  children: ReactNode;
};

export function BusinessListVenueButton({ className, children }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>

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
