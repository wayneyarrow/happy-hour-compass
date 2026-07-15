import type { ReactNode } from "react";

/**
 * Vertical guided-journey steps for Claim Your Venue. Deliberately its own
 * component rather than a reuse of JourneyTimeline (built for short milestone
 * labels in an even N-column grid, not one step needing much more room than
 * its neighbours to host a full-width screenshot). Steps without a `visual`
 * center their text in a narrow column, matching the calm, editorial feel of
 * the rest of the page; the one step with a `visual` gets a two-column row
 * so the screenshot has room to breathe.
 */

export type ClaimJourneyStep = {
  number: number;
  title: string;
  description: ReactNode;
  visual?: ReactNode;
};

type Props = {
  steps: readonly ClaimJourneyStep[];
};

export function ClaimJourneySteps({ steps }: Props) {
  return (
    <div>
      {steps.map((step, i) => (
        <div key={step.number}>
          <div
            className={
              step.visual
                ? "grid md:grid-cols-[minmax(0,340px)_1fr] gap-8 md:gap-14 items-center"
                : "max-w-xl mx-auto text-center"
            }
          >
            <div>
              <div
                className={
                  "w-10 h-10 rounded-full bg-amber-100 text-amber-700 font-bold text-base flex items-center justify-center mb-5" +
                  (step.visual ? "" : " mx-auto")
                }
                aria-hidden="true"
              >
                {step.number}
              </div>
              <h3 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight">
                {step.title}
              </h3>
              <div className="mt-3 text-base text-gray-500 leading-relaxed">
                {step.description}
              </div>
            </div>
            {step.visual && <div>{step.visual}</div>}
          </div>
          {i < steps.length - 1 && (
            <div className="my-14 md:my-20 border-t border-gray-200" aria-hidden="true" />
          )}
        </div>
      ))}
    </div>
  );
}
