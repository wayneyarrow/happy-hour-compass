import { VenuePageBottomPreview } from "./VenuePageBottomPreview";
import type { ClaimJourneyStep } from "./ClaimJourneySteps";

/**
 * Static copy for the guided journey, kept separate from page.tsx the same
 * way /business splits content.tsx from its layout — page.tsx stays focused
 * on structure, this file stays focused on the words.
 */
export const JOURNEY_STEPS: readonly ClaimJourneyStep[] = [
  {
    number: 1,
    title: "Find your venue",
    description:
      "Search for your restaurant or bar below. If it's already listed on Happy Hour Compass, it'll show up in the results.",
  },
  {
    number: 2,
    title: "Review your venue",
    description: (
      <>
        Open your venue&rsquo;s public page and take a look — make sure everything
        looks right. Then scroll to the bottom and select{" "}
        <span className="font-semibold text-gray-700">Claim This Venue</span>.
      </>
    ),
    visual: <VenuePageBottomPreview />,
  },
  {
    number: 3,
    title: "Complete your claim",
    description:
      "Fill out the short verification form. We'll review your request and let you know as soon as it's approved — usually within a day or two.",
  },
] as const;
