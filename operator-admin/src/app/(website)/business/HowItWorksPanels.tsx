import type { ReactNode } from "react";

/**
 * "Getting Started is Easy" feature panels — four icon-led cards explaining
 * the path from listing a venue to welcoming more guests. Business-page-local
 * (not pulled up to a shared (website)/ component like JourneyTimeline or
 * ProductTour): unlike those, nothing else on the site needs this exact
 * card treatment yet, and NumberedStepList already covers the plain
 * numbered-circle pattern for claim-your-venue/page.tsx — this is a
 * deliberately different visual language (icon + bordered card, no
 * numbers), not a variant of that component.
 *
 * The progression from step to step is communicated by the left-to-right
 * (then wrapping) card order alone — no connecting line or per-card
 * affordance, so it doesn't read as a rehash of the later "More Guests
 * Starts Here" journey section. The last card gets a soft warm tint
 * instead, marking it as the destination/payoff rather than another step.
 */

export type HowItWorksPanel = {
  id: string;
  title: string;
  description: ReactNode;
  icon: ReactNode;
};

type Props = {
  panels: readonly HowItWorksPanel[];
};

export function HowItWorksPanels({ panels }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {panels.map((panel, index) => {
        const isLast = index === panels.length - 1;
        return (
          <div
            key={panel.id}
            className={`relative rounded-2xl border p-8 text-center shadow-[0_2px_12px_rgba(0,0,0,0.05)] ${
              isLast
                ? "border-amber-200 bg-gradient-to-b from-amber-50/70 to-white"
                : "border-gray-200 bg-white"
            }`}
          >
            <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-50 ring-1 ring-amber-200/70 text-amber-700 items-center justify-center mb-6">
              {panel.icon}
            </div>
            <h3 className="text-xl font-bold text-gray-900 whitespace-nowrap">{panel.title}</h3>
            <p className="mt-2.5 mx-auto max-w-[230px] text-sm text-gray-500 leading-relaxed">
              {panel.description}
            </p>
          </div>
        );
      })}
    </div>
  );
}
