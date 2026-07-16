import type { ClaimJourneyStep } from "./ClaimJourneySteps";

/**
 * Static copy + screenshot metadata for the four-step walkthrough. Kept
 * separate from page.tsx the same way /business splits content.tsx from its
 * layout — page.tsx stays focused on structure, this file stays focused on
 * the words and which production screenshot belongs to which step.
 *
 * Image width/height are each screenshot's real pixel dimensions (read from
 * the PNG itself) — required by next/image when not using `fill`, and what
 * lets ClaimJourneySteps render every screenshot at its own true aspect
 * ratio with zero cropping.
 */
export const JOURNEY_STEPS: readonly ClaimJourneyStep[] = [
  {
    number: 1,
    title: "Find your venue",
    description:
      "Use the search on the Happy Hour Compass homepage to find your venue. Search by venue name, city, or neighbourhood, then select your venue from the results.",
    image: {
      src: "/images/business/claim-page-search.png",
      alt: "Searching for a venue by name on the Happy Hour Compass homepage and selecting it from the results",
      width: 876,
      height: 550,
    },
  },
  {
    number: 2,
    title: "Open your venue page",
    description:
      "Make sure you've opened the correct venue page before continuing. Confirm the venue name and location match your business.",
    image: {
      src: "/images/business/claim-page-venue-hero.png",
      alt: "A venue's public page, showing its name, photo, and location",
      width: 1688,
      height: 866,
    },
  },
  {
    number: 3,
    title: <>Click &ldquo;Claim this venue&rdquo;</>,
    description: (
      <>
        Scroll to the bottom of the venue page and click{" "}
        <span className="font-semibold text-gray-700">Claim this venue</span>{" "}
        to begin the verification process.
      </>
    ),
    image: {
      src: "/images/business/claim-page-claim-button.png",
      alt: "The bottom of a venue page, with the Claim this venue button highlighted",
      width: 876,
      height: 550,
    },
  },
  {
    number: 4,
    title: "Complete the verification form",
    description:
      "Fill out the short verification form and submit your request. We'll review your claim and email you once it's been approved.",
    image: {
      src: "/images/business/claim-page-form.png",
      alt: "The claim verification form, ready to fill out and submit",
      width: 596,
      height: 843,
    },
  },
] as const;
