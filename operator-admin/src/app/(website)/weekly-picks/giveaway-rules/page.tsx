import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

/**
 * Official rules for the Your Happy Hour Plans Giveaway (November 2026).
 *
 * The text is the approved "Your Happy Hour Plans Giveaway — Official
 * Rules" document, published verbatim (wording, section order, dates and
 * contact details unchanged; the paragraph split by the PDF's page break is
 * rejoined). Do not edit the wording without an updated approved source.
 *
 * Always available: this page is static and deliberately does NOT read the
 * callout schedule in src/lib/weeklyPicks/giveaway.ts, so it stays live
 * after the contest closes, through the draw and winner confirmation.
 */

export const metadata: Metadata = buildPageMetadata({
  title: "Your Happy Hour Plans Giveaway — Official Rules",
  description:
    "Official rules for the Your Happy Hour Plans Giveaway from Happy Hour Compass: win a $100 CAD gift card to The Train Station Pub. Open to BC residents 19+. No purchase necessary.",
  path: "/weekly-picks/giveaway-rules",
});

const CONTACT_EMAIL = "hello@happyhourcompass.com";

function Rule({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24">
      <h2 id={`${id}-heading`} className="text-base md:text-lg font-bold text-gray-900">
        {title}
      </h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

const linkClass = "font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-800 break-words";

export default function GiveawayRulesPage() {
  return (
    <section className="bg-amber-50/60">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-10 md:pt-16 pb-14 md:pb-20">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">Your Happy Hour Plans</p>
        <h1 className="mt-2 text-3xl md:text-[2.5rem] font-bold text-gray-900 tracking-tight leading-tight">
          Your Happy Hour Plans Giveaway — Official Rules
        </h1>

        <article className="mt-8 rounded-2xl bg-white border border-amber-100 shadow-[0_1px_8px_rgba(0,0,0,0.05)] px-5 py-6 sm:px-8 sm:py-8 text-[15px] md:text-base text-gray-700 leading-relaxed">
          <p className="font-bold text-gray-900">NO PURCHASE NECESSARY.</p>

          <div className="mt-6 space-y-7">
            <Rule id="sponsor" title="1. Sponsor.">
              <p>
                This contest is run by Yellow Lab Software, operating as Happy Hour Compass, Kelowna, BC
                (&ldquo;Happy Hour Compass,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;).
              </p>
            </Rule>

            <Rule id="contest-period" title="2. Contest period.">
              <p>
                The contest begins at 11:00 a.m. Pacific Time on November 12, 2026 and ends at 11:59 p.m.
                Pacific Time on November 30, 2026 (the &ldquo;Contest Period&rdquo;).
              </p>
            </Rule>

            <Rule id="eligibility" title="3. Eligibility.">
              <p>
                Open to legal residents of British Columbia who are 19 years of age or older at the time of
                entry. Employees of Happy Hour Compass and The Train Station Pub, and members of their
                immediate households, are not eligible.
              </p>
            </Rule>

            <Rule id="how-to-enter" title="4. How to enter.">
              <p>
                <strong className="text-gray-900">Main entry:</strong> Subscribe to <em>Your Happy Hour Plans</em>,
                our free weekly email, at{" "}
                <Link href="/weekly-picks" className={linkClass}>
                  happyhourcompass.com/weekly-picks
                </Link>{" "}
                during the Contest Period and confirm your subscription. People who are already subscribed
                when the contest begins are entered automatically. Limit of one (1) main entry per person and
                per email address.
              </p>
              <p>
                <strong className="text-gray-900">Bonus entries:</strong> Comment on the official contest post on
                @happyhourcompass&rsquo;s Instagram and tag a friend. Each comment tagging a different friend
                earns one (1) bonus entry, up to a maximum of five (5) bonus entries per person. Tags must be
                real people, not businesses, brands or celebrity accounts. Tagging the same friend more than
                once counts only once. Bonus entries count only if the person commenting has a valid main
                entry.
              </p>
              <p>
                Commenting the word &ldquo;PLANS&rdquo; to receive the signup link by DM does not on its own count
                as an entry.
              </p>
            </Rule>

            <Rule id="prize" title="5. Prize.">
              <p>
                One (1) prize is available: a $100 CAD gift card to The Train Station Pub. The gift card is
                subject to The Train Station Pub&rsquo;s terms. The prize must be accepted as awarded, cannot be
                transferred, and cannot be exchanged for cash. We may substitute a prize of equal or greater
                value if necessary.
              </p>
            </Rule>

            <Rule id="odds" title="6. Odds.">
              <p>
                The odds of winning depend on the number of eligible entries received during the Contest
                Period.
              </p>
            </Rule>

            <Rule id="draw" title="7. Draw and winner selection.">
              <p>
                One potential winner will be selected by random draw from all eligible entries on or about
                December 2, 2026, in Kelowna, BC. We will contact the potential winner by Instagram direct
                message or email. The potential winner must respond within five (5) days. Before being
                confirmed, the potential winner must correctly answer, without assistance, a mathematical
                skill-testing question. If the potential winner cannot be reached, does not respond in time,
                is not eligible, or does not answer correctly, we may select another entry.
              </p>
            </Rule>

            <Rule id="your-information" title="8. Your information.">
              <p>
                By entering, you agree to receive <em>Your Happy Hour Plans</em> weekly emails from Happy Hour
                Compass. You can unsubscribe at any time using the link in every email. Unsubscribing before
                the draw removes your entry. We use your information only to run the contest and send the
                newsletter, and we never sell it. The winner agrees that their first name and Instagram
                handle may be announced publicly.
              </p>
            </Rule>

            <Rule id="instagram" title="9. Instagram.">
              <p>
                This contest is in no way sponsored, endorsed, administered by, or associated with Instagram
                or Meta. By entering, you release Instagram and Meta from any liability related to this
                contest.
              </p>
            </Rule>

            <Rule id="general" title="10. General.">
              <p>
                We reserve the right to disqualify entries made using fake accounts, automated means, or that
                otherwise do not follow these rules. We may modify or cancel the contest if it cannot run as
                planned. The contest is governed by the laws of British Columbia and the federal laws of
                Canada that apply there.
              </p>
            </Rule>
          </div>

          <p className="mt-8 pt-6 border-t border-gray-100">
            <strong className="text-gray-900">Questions?</strong> Contact{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </article>
      </div>
    </section>
  );
}
