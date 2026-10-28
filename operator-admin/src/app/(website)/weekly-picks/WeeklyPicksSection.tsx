import type { WeeklyPicksPlacement } from "@/lib/weeklyPicks/weeklyPicks";
import { WeeklyPicksSignupForm } from "./WeeklyPicksSignupForm";

/**
 * Fixed Weekly Picks signup band for the homepage and guides. Deliberately
 * outside the CMS section list (no Homepage section type) — see
 * (website)/page.tsx. Every placement renders the same form/action.
 *
 * - "page-width": full-width homepage band matching the homepage sections'
 *   own max-w-7xl gutter and border-t rhythm.
 * - "inline": sits inside an existing content column (guides).
 */
type Props = {
  placement: WeeklyPicksPlacement;
  variant: "full" | "compact";
  layout: "page-width" | "inline";
};

export function WeeklyPicksSection({ placement, variant, layout }: Props) {
  const card = (
    <div
      className={`rounded-2xl md:rounded-3xl bg-amber-50 border border-amber-100 ${
        variant === "full" ? "px-5 py-7 sm:px-8 md:px-12 md:py-10" : "px-5 py-6 sm:px-7 md:px-8 md:py-7"
      }`}
    >
      <div className={variant === "full" ? "max-w-2xl" : ""}>
        <WeeklyPicksSignupForm placement={placement} variant={variant} />
      </div>
    </div>
  );

  if (layout === "inline") {
    return (
      <section aria-label="Your Happy Hour Plans newsletter signup" className="mb-12">
        {card}
      </section>
    );
  }

  return (
    <section aria-label="Your Happy Hour Plans newsletter signup" className="py-10 md:py-12 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">{card}</div>
    </section>
  );
}
