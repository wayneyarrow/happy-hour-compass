import type { Metadata } from "next";
import { CurrentOpenings } from "./CurrentOpenings";
import { ContactUsTrigger } from "./ContactUsTrigger";
import { OPEN_POSITIONS, FUTURE_TEAMS } from "./content";
import { buildBreadcrumbListNode } from "@/lib/seo/schema/breadcrumb";
import { JsonLd } from "@/app/(website)/JsonLd";

/**
 * Public Careers page. Deliberately simpler than /business: no product
 * tour, no pricing, no FAQ — three short sections (current openings, future
 * growth areas, general interest) plus a focused hero, per the Careers page
 * task. Honest about having no current openings rather than implying
 * hiring activity that doesn't exist; see content.tsx for why
 * OPEN_POSITIONS is an empty array rather than placeholder job cards.
 *
 * A plain server component: the only interactive piece, the Contact Us
 * trigger, is its own client component — same split as /business and
 * /claim-your-venue.
 */

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Join the Happy Hour Compass team. See our current openings and where we're planning to grow.",
};

export default function CareersPage() {
  const breadcrumbNode = buildBreadcrumbListNode({
    canonicalPath: "/careers",
    items: [
      { name: "Home", path: "/" },
      { name: "Careers", path: "/careers" },
    ],
  });

  return (
    <>
      <JsonLd nodes={[breadcrumbNode]} />
      <div>
      {/* ── 1. Hero ───────────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 lg:px-10 pt-16 md:pt-24 pb-16 md:pb-24 text-center">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-4">
          Careers
        </p>
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 tracking-tight">
          Join the Happy Hour Compass Team
        </h1>
        <p className="mt-5 text-lg text-gray-500 leading-relaxed max-w-xl mx-auto">
          We&rsquo;re building a better way for people to discover local places,
          experiences, and happy hours&mdash;and we&rsquo;re always interested in
          meeting thoughtful people who want to help.
        </p>
      </section>

      {/* ── 2. Current openings ──────────────────────────────────────────── */}
      <section className="bg-gray-50">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 py-16 md:py-24">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight text-center">
            Current openings
          </h2>
          <div className="mt-10">
            <CurrentOpenings openings={OPEN_POSITIONS} />
          </div>
        </div>
      </section>

      {/* ── 3. Where we'll grow ──────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 lg:px-10 py-16 md:py-24">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
            Where we&rsquo;ll grow
          </h2>
          <p className="mt-4 text-base text-gray-500 leading-relaxed">
            As Happy Hour Compass grows, these are the areas we expect to
            build out first.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FUTURE_TEAMS.map((team) => (
            <div
              key={team.id}
              className="rounded-2xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.05)] p-8 text-center"
            >
              <h3 className="text-lg font-bold text-gray-900">{team.name}</h3>
              <p className="mt-2.5 text-sm text-gray-500 leading-relaxed">
                {team.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 4. General interest ──────────────────────────────────────────── */}
      <section className="bg-gray-50">
        <div className="max-w-2xl mx-auto px-6 lg:px-10 py-16 md:py-24 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
            Think you&rsquo;d be a great fit?
          </h2>
          <p className="mt-4 text-base text-gray-500 leading-relaxed">
            We&rsquo;re always happy to hear from talented people who care about
            local hospitality, useful technology, and great customer
            experiences.
          </p>
          <p className="mt-2 text-sm text-gray-400">
            This isn&rsquo;t an application for a specific role &mdash; it&rsquo;s a
            way to introduce yourself for whenever the right opportunity
            comes up.
          </p>
          <div className="mt-8">
            <ContactUsTrigger />
          </div>
        </div>
      </section>
      </div>
    </>
  );
}
