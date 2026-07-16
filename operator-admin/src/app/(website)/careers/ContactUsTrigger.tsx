"use client";

import { useState } from "react";
import { AcquisitionModal } from "@/app/(website)/acquisition/AcquisitionModal";
import { ContactUsModalContent } from "@/app/(website)/acquisition/ContactUsModalContent";

const PRIMARY_CTA_CLASS =
  "inline-flex items-center justify-center px-8 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2";

/**
 * "Contact Us" trigger for the General Interest section. Reuses
 * AcquisitionModal + ContactUsModalContent exactly as the footer already
 * does — same modal, same title/description copy, same submitContactAction
 * underneath — so general-interest messages from this page land in the
 * same inbox as every other Contact Us submission. No careers-specific
 * form, no résumé upload, no new action.
 */
export function ContactUsTrigger() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={PRIMARY_CTA_CLASS}
      >
        Contact Us
      </button>

      <AcquisitionModal
        open={open}
        onClose={() => setOpen(false)}
        title="Contact Us"
        description="Have a question or feedback? We'd love to hear from you."
      >
        <ContactUsModalContent onDone={() => setOpen(false)} />
      </AcquisitionModal>
    </>
  );
}
