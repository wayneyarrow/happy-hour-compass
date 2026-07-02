"use client";

import { useState } from "react";
import { AcquisitionModal } from "@/app/(website)/acquisition/AcquisitionModal";
import { ClaimVenueModalContent } from "@/app/(website)/acquisition/ClaimVenueModalContent";

type Props = {
  venueRouteParam: string;
  venueName: string;
};

/**
 * Renders the "Own or manage this venue?" CTA and wires it to the
 * AcquisitionModal + ClaimVenueModalContent. Keeps the server page free
 * of client-side state while preserving the exact same visual treatment.
 */
export function ClaimVenueCTA({ venueRouteParam, venueName }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className="rounded-2xl p-5 flex items-center gap-4"
        style={{
          background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
          border: "1px solid #fde68a",
        }}
      >
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#92400e"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 18, height: 18 }}
            aria-hidden="true"
          >
            <path d="M3 21h18" />
            <path d="M5 21V7l7-4 7 4v14" />
            <rect x="9" y="12" width="6" height="9" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900 mb-0.5">
            Own or manage this venue?
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-sm font-medium text-amber-700 hover:text-amber-800 transition-colors"
          >
            Claim this venue →
          </button>
        </div>
      </div>

      <AcquisitionModal
        open={open}
        onClose={() => setOpen(false)}
        title="Claim This Venue"
        description={`Claim ${venueName} to manage your happy hour schedule, specials, and business information.`}
      >
        <ClaimVenueModalContent
          venueRouteParam={venueRouteParam}
          venueName={venueName}
          onDone={() => setOpen(false)}
        />
      </AcquisitionModal>
    </>
  );
}
