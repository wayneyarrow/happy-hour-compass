import type { ReactNode } from "react";

/**
 * Illustrated milestone journey — horizontal with a connecting line on
 * desktop, vertical stacked with a connecting line on mobile. Built for the
 * business page's "More Guests Starts Here" section (Business Funnel
 * Blueprint, Section 5), but kept generic (heading/intro/milestones as
 * props, no business-specific copy) so future business pages can reuse it
 * for their own milestone journeys.
 *
 * Deliberately has no numbers and no arrows in the visual treatment — the
 * connecting line itself carries the sense of progression, per the
 * blueprint. Server component; no scroll-triggered reveal animation in
 * this v1 (a documented follow-up, not required for the foundation).
 */

export type JourneyMilestone = {
  id: string;
  title: string;
  detail: ReactNode;
  /** Illustration placeholder for this milestone's marker. Falls back to a plain dot. */
  icon?: ReactNode;
};

type Props = {
  heading: string;
  intro?: string;
  milestones: JourneyMilestone[];
};

export function JourneyTimeline({ heading, intro, milestones }: Props) {
  // Each marker sits at the center of its column; half a column's width
  // inset on each side lines the connector up with the first/last marker
  // regardless of how many milestones are passed in.
  const lineInset = `${100 / (milestones.length * 2)}%`;

  return (
    <section aria-label={heading} className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">{heading}</h2>
        {intro && (
          <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">{intro}</p>
        )}
      </div>

      {/* Desktop: horizontal journey with a single connecting line */}
      <div
        className="hidden md:grid relative mt-16"
        style={{ gridTemplateColumns: `repeat(${milestones.length}, minmax(0, 1fr))` }}
      >
        <div
          className="absolute top-6 h-px bg-amber-200"
          style={{ left: lineInset, right: lineInset }}
          aria-hidden="true"
        />
        {milestones.map((milestone) => (
          <div key={milestone.id} className="relative flex flex-col items-center text-center px-4">
            <div className="relative z-10 w-12 h-12 rounded-full bg-white border-2 border-amber-200 flex items-center justify-center mb-5 shadow-sm">
              {milestone.icon ?? <DefaultMarker />}
            </div>
            <h3 className="text-lg font-semibold text-gray-900">{milestone.title}</h3>
            <div className="mt-2 text-sm text-gray-500 leading-relaxed">{milestone.detail}</div>
          </div>
        ))}
      </div>

      {/* Mobile: vertical stacked journey with a connecting line */}
      <div className="md:hidden mt-12">
        {milestones.map((milestone, i) => (
          <div key={milestone.id} className="relative flex gap-5 pb-10 last:pb-0">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-10 h-10 rounded-full bg-white border-2 border-amber-200 flex items-center justify-center shadow-sm z-10">
                {milestone.icon ?? <DefaultMarker />}
              </div>
              {i < milestones.length - 1 && (
                <div className="w-px flex-1 bg-amber-200 mt-1" aria-hidden="true" />
              )}
            </div>
            <div className="pt-1.5">
              <h3 className="text-base font-semibold text-gray-900">{milestone.title}</h3>
              <div className="mt-1.5 text-sm text-gray-500 leading-relaxed">{milestone.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DefaultMarker() {
  return <span className="w-2 h-2 rounded-full bg-amber-400" aria-hidden="true" />;
}
