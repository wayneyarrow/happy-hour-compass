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
  /** A short second line beneath intro that bridges into the milestones below — more assertive than intro, but still not competing with the heading. */
  bridge?: string;
  milestones: JourneyMilestone[];
};

export function JourneyTimeline({ heading, intro, bridge, milestones }: Props) {
  // Each marker sits at the center of its column; half a column's width
  // inset on each side lines the connector up with the first/last marker
  // regardless of how many milestones are passed in.
  const lineInset = `${100 / (milestones.length * 2)}%`;

  const lastIndex = milestones.length - 1;

  return (
    <section aria-label={heading} className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">{heading}</h2>
        {intro && (
          <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">{intro}</p>
        )}
        {bridge && (
          <p className="mt-6 text-base md:text-lg font-semibold text-gray-900 leading-relaxed">
            {bridge}
          </p>
        )}
      </div>

      {/* Desktop: horizontal journey with a single connecting line */}
      <div
        className="hidden md:grid relative mt-20"
        style={{ gridTemplateColumns: `repeat(${milestones.length}, minmax(0, 1fr))` }}
      >
        <div
          className="absolute top-6 h-[2px] bg-amber-300"
          style={{ left: lineInset, right: lineInset }}
          aria-hidden="true"
        />
        {milestones.map((milestone, i) => (
          <div key={milestone.id} className="relative flex flex-col items-center text-center px-4">
            <div
              className={`relative z-10 w-12 h-12 rounded-full border-2 flex items-center justify-center mb-5 shadow-sm ${
                i === lastIndex ? "bg-amber-50 border-amber-300" : "bg-white border-amber-200"
              }`}
            >
              {milestone.icon ?? <DefaultMarker />}
            </div>
            <h3 className="text-lg font-semibold text-gray-900">{milestone.title}</h3>
            <div className="mt-2 text-sm text-gray-500 leading-relaxed">{milestone.detail}</div>
          </div>
        ))}
      </div>

      {/* Mobile: vertical stacked journey with a connecting line */}
      <div className="md:hidden mt-14">
        {milestones.map((milestone, i) => (
          <div key={milestone.id} className="relative flex gap-5 pb-10 last:pb-0">
            <div className="flex flex-col items-center shrink-0">
              <div
                className={`w-10 h-10 rounded-full border-2 flex items-center justify-center shadow-sm z-10 ${
                  i === lastIndex ? "bg-amber-50 border-amber-300" : "bg-white border-amber-200"
                }`}
              >
                {milestone.icon ?? <DefaultMarker />}
              </div>
              {i < lastIndex && (
                <div className="w-[2px] flex-1 bg-amber-300 mt-1" aria-hidden="true" />
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
