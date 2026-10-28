import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo/metadata";
import { WEEKLY_PICKS_EYEBROW, WEEKLY_PICKS_HEADLINE, WEEKLY_PICKS_PROMISE } from "@/lib/weeklyPicks/weeklyPicks";
import { WeeklyPicksSignupForm } from "./WeeklyPicksSignupForm";

/**
 * Public Weekly Picks landing page — the permanent destination for
 * newsletter campaign links. Headline and form sit at the top of the page
 * on every screen size. Signup is Brevo-managed double opt-in; see
 * src/lib/weeklyPicks/signup.ts.
 */

export const metadata: Metadata = buildPageMetadata({
  title: "Your Happy Hour Plans newsletter",
  description:
    "Your Happy Hour Plans is a free weekly Thursday email with local happy hours, food finds, daily specials and events across Kelowna, West Kelowna and Lake Country.",
  path: "/weekly-picks",
});

const INCLUDED = [
  "Happy hours worth planning around",
  "Food finds and daily specials",
  "Events happening this week",
  "Occasional local venue spotlights",
];

export default function WeeklyPicksPage() {
  return (
    <section className="bg-amber-50/60">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-10 md:pt-16 pb-14 md:pb-20">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">{WEEKLY_PICKS_EYEBROW}</p>
        <h1 className="mt-2 text-3xl md:text-[2.75rem] font-bold text-gray-900 tracking-tight leading-tight">
          {WEEKLY_PICKS_HEADLINE}
        </h1>
        <p className="mt-4 text-base md:text-lg text-gray-600 leading-relaxed">
          {WEEKLY_PICKS_PROMISE}
        </p>

        <div className="mt-8 rounded-2xl bg-white border border-amber-100 shadow-[0_1px_8px_rgba(0,0,0,0.05)] px-5 py-6 sm:px-7 sm:py-7">
          <WeeklyPicksSignupForm placement="weekly_picks_page" variant="full" headingAs="h1" hideIntro />
        </div>

        <h2 className="mt-10 text-sm font-bold text-gray-900">What you&rsquo;ll get every Thursday</h2>
        <ul className="mt-3 space-y-2">
          {INCLUDED.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-[15px] text-gray-700">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
