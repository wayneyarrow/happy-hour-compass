import Link from "next/link";
import { BusinessListVenueButton } from "./BusinessListVenueButton";

/**
 * `afterAnswer` content for the "claim vs. add" FAQ item — two direct
 * paths into the correct acquisition flow, appended after that answer's
 * plain-text paragraphs (FaqAccordion.tsx renders `answer` then
 * `afterAnswer` inside the same answer container).
 *
 * "Submit your venue" reuses BusinessListVenueButton as-is — same
 * self-contained open/close state and the same AcquisitionModal +
 * AddVenueModalContent flow already used by the hero and final-CTA
 * buttons on this page — just restyled via `className` to read as an
 * inline link rather than a pill CTA. No second modal, no new state.
 *
 * The links are font-bold — one step heavier than the "Already listed?"
 * / "Not listed yet?" lead-ins (font-semibold) — so each line reads
 * lead-in-then-action rather than the bold dark lead-in text visually
 * outweighing the amber link next to it.
 */

const LINK_CLASS =
  "p-0 m-0 border-0 bg-transparent align-baseline font-bold text-amber-600 hover:text-amber-700 underline underline-offset-2 decoration-amber-300 hover:decoration-amber-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-sm";

export function ClaimVsAddFaqLinks() {
  return (
    <div className="mt-6 space-y-2">
      <p>
        <span className="font-semibold text-gray-800">Already listed?</span>{" "}
        <Link href="/claim-your-venue" className={LINK_CLASS}>
          Learn how to claim your business.
        </Link>
      </p>
      <p>
        <span className="font-semibold text-gray-800">Not listed yet?</span>{" "}
        <BusinessListVenueButton className={LINK_CLASS}>
          Submit your venue.
        </BusinessListVenueButton>
      </p>
    </div>
  );
}
