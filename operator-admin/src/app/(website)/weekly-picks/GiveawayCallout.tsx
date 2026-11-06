import Link from "next/link";
import { GIVEAWAY_RULES_PATH } from "@/lib/weeklyPicks/giveaway";

/**
 * Your Happy Hour Plans Giveaway callout — shown on /weekly-picks only,
 * directly below the signup form's consent copy, during the contest window
 * (see isGiveawayCalloutVisible in src/lib/weeklyPicks/giveaway.ts; the
 * page decides visibility). Informational only: the signup button stays the
 * primary action, and nothing here changes signup, confirmation or consent.
 */
export function GiveawayCallout() {
  return (
    <aside
      aria-labelledby="giveaway-callout-heading"
      className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 sm:px-5"
    >
      <h2 id="giveaway-callout-heading" className="text-sm font-bold text-gray-900">
        Your Happy Hour Plans Giveaway
      </h2>
      <p className="mt-1.5 text-[13px] sm:text-sm text-gray-700 leading-relaxed">
        Enter to win a $100 gift card to The Train Station Pub. Sign up and confirm your subscription
        to enter. Already subscribed? You&rsquo;re automatically entered if eligible.
      </p>
      <p className="mt-2 text-[13px] sm:text-sm">
        <Link
          href={GIVEAWAY_RULES_PATH}
          className="font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-800"
        >
          View official giveaway rules
        </Link>
      </p>
    </aside>
  );
}
