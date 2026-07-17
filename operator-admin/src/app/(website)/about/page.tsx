import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PRINCIPLES } from "./content";
import { buildAboutPageNode } from "@/lib/seo/schema/aboutPage";
import { buildBreadcrumbListNode } from "@/lib/seo/schema/breadcrumb";
import { JsonLd } from "@/app/(website)/JsonLd";
import { buildPageMetadata } from "@/lib/seo/metadata";

/**
 * Public About Us page — first editorial draft. Tells the Happy Hour
 * Compass story as a magazine-style narrative (customer's question →
 * the realization that led to building this → what we believe → where
 * things stand today) rather than a corporate bio or company timeline.
 * Deliberately has no founder photo, team bios, or headshots — the
 * story itself is the human element, per this task's brief.
 *
 * Reuses the visual language established by /business and /careers
 * rather than inventing anything new: the centered eyebrow+headline
 * hero (careers/page.tsx), the editorial image+prose section and the
 * amber-accent pull-quote block (business/page.tsx Section 3), the
 * three-card icon grid (business/page.tsx PILLARS), and the dark final
 * CTA band (business/page.tsx Section 9).
 *
 * The opening story image (about-us-hh-sign.jpg) uses aspect-[3/2] — the
 * source photo's exact native ratio (5472x3648) — instead of the site's
 * usual aspect-[4/5] portrait crop. The person reading the sign sits at
 * the left edge of the frame, so any portrait crop tight enough to keep
 * the "HAPPY HOUR" text legible pushes them out entirely; matching the
 * container to the photo's own ratio shows the whole frame (person and
 * sign both), with zero cropping and zero stretching, rather than
 * trying to find an object-position that threads both subjects.
 *
 * The wrapper is sized at w-[95%] (not w-full) — still inset within its
 * grid column like every other editorial image on this page, just less
 * so than the original w-[88%]. At a fixed aspect ratio, area scales
 * with width squared, so 88% → 95% is an ~17% increase in on-page visual
 * weight (a deliberate rebalance against the text column) while staying
 * safely inside the column — no risk of overflowing into the gap.
 *
 * The Turning Point section (below) narrates the founder's background in
 * third person / singular "they" — deliberately never named, no photo,
 * no dates — then hands off to "Happy Hour Compass" by name only at the
 * very end (the pull quote), so the story has one consistent narrator
 * throughout instead of drifting between "the founder" and "we".
 *
 * A plain server component — nothing on this page is interactive, so
 * unlike /business and /careers there's no client-component split.
 *
 * First draft: expect the copy and section balance here to be revised
 * once this is reviewed. See the Implementation Summary for specific
 * areas flagged for a second pass.
 */

export const metadata: Metadata = buildPageMetadata({
  title: "About Us",
  description:
    "Happy Hour Compass helps people discover great local happy hours and events, while helping the businesses that host them get discovered.",
  path: "/about",
});

const PRIMARY_CTA_CLASS =
  "inline-flex items-center justify-center px-8 py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2";

const SECONDARY_CTA_DARK_CLASS =
  "inline-flex items-center justify-center px-8 py-3.5 border border-gray-700 text-white hover:bg-gray-800 font-semibold rounded-full text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900";

export default function AboutPage() {
  // Page-specific AboutPage structured data. name/description repeat the
  // same literal values as the `metadata` export above ("About Us" / the
  // approved SEO description) rather than reading `metadata.title` /
  // `metadata.description` at runtime — Next.js's Metadata["title"] type
  // is a union (string | template object | null), not a plain string, and
  // there's no generateMetadata() function here to call a second time the
  // way venue/guide/collection schema does; this is a static metadata
  // object with two literal strings, so they're repeated once here rather
  // than restructuring the metadata export to share them.
  const aboutPageNode = buildAboutPageNode({
    canonicalPath: "/about",
    name: "About Us",
    description:
      "Happy Hour Compass helps people discover great local happy hours and events, while helping the businesses that host them get discovered.",
  });

  const breadcrumbNode = buildBreadcrumbListNode({
    canonicalPath: "/about",
    items: [
      { name: "Home", path: "/" },
      { name: "About Us", path: "/about" },
    ],
  });

  return (
    <>
      <JsonLd nodes={[aboutPageNode, breadcrumbNode]} />
      <div>
      {/* ── 1. Hero ─────────────────────────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 lg:px-10 pt-16 md:pt-24 pb-16 md:pb-24 text-center">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-4">
          About Us
        </p>
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 tracking-tight leading-[1.15]">
          Great local experiences shouldn&rsquo;t be hard to find.
        </h1>
        <p className="mt-6 text-lg text-gray-500 leading-relaxed max-w-xl mx-auto">
          Happy Hour Compass helps people discover where to go &mdash; happy
          hours, events, and local favourites &mdash; while helping the
          businesses that host them get discovered by guests who are
          already looking.
        </p>
      </section>

      {/* ── 2. It started with one simple question ────────────────────────
          Editorial image+prose layout, same shape as business/page.tsx
          Section 3 ("Why Happy Hour Compass Exists") but mirrored —
          image on the left here, text on the right there was text-left —
          so the two pages don't read as the same template repeated. */}
      <section className="bg-white">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div className="w-[95%] mx-auto lg:order-1">
              <div className="relative aspect-[3/2] w-full rounded-2xl overflow-hidden shadow-[0_24px_64px_rgba(0,0,0,0.10),0_4px_16px_rgba(0,0,0,0.06)]">
                <Image
                  src="/images/business/about-us-hh-sign.jpg"
                  alt="A person pausing to read a handwritten happy hour sign outside a local restaurant"
                  fill
                  sizes="(min-width: 1024px) 445px, (min-width: 768px) 620px, 88vw"
                  className="object-cover object-center"
                />
              </div>
            </div>
            <div className="text-left lg:order-2">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
                It started with one simple question.
              </h2>
              <p className="mt-6 text-2xl md:text-3xl font-semibold text-gray-900 leading-snug">
                &ldquo;Where should we go?&rdquo;
              </p>
              <p className="mt-6 text-base md:text-lg text-gray-500 leading-relaxed">
                You&rsquo;re somewhere new &mdash; a different neighbourhood, a
                different city &mdash; and you just want a good place to grab a
                drink and something to eat. Somewhere with a real happy hour,
                not a stale deal from three years ago.
              </p>
              <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
                So you start looking. A few Google searches. Social posts
                from months ago. A &ldquo;best happy hours in town&rdquo;
                blog post with hours that changed a long time ago.
              </p>
              <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
                You piece together an answer from five different places and
                you&rsquo;re still not sure it&rsquo;s right &mdash; and
                somewhere nearby, there&rsquo;s probably a great local spot
                with exactly what you were looking for. You just had no way
                to find it.
              </p>
              <p className="mt-6 text-lg md:text-xl font-bold text-gray-900 tracking-tight">
                Finding a great local happy hour shouldn&rsquo;t take this
                much work.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. The turning point ───────────────────────────────────────────
          Deliberately no image here — a centered editorial text block
          instead of another photo section, so the page has visual
          rhythm rather than three near-identical image+text blocks in a
          row. The amber-accent pull-quote reuses business/page.tsx
          Section 3's exact treatment (pl-5 border-l-4 border-amber-400). */}
      <section className="bg-gray-50">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-20 md:pt-28 pb-16 md:pb-24 text-center">
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest mb-4">
            The Turning Point
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            Happy Hour Compass didn&rsquo;t start with a business plan.
          </h2>
          <div className="mt-10 text-left">
            <p className="text-base md:text-lg text-gray-500 leading-relaxed">
              It started with the founder&rsquo;s own path through
              hospitality &mdash; behind the bar, serving tables, in the
              kitchen, and eventually running a restaurant of their own.
              From there, they moved into consulting, helping other
              restaurants and bars work through many of the same problems
              from the outside.
            </p>
            <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
              That same instinct for solving problems eventually led into
              software too &mdash; years spent building tools for customers,
              working in Customer Success, and learning firsthand what makes
              software genuinely useful.
            </p>
            <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
              And somewhere along the way, on the road for work as often as
              for fun, the same simple question kept finding them:
              &ldquo;Where should we go tonight?&rdquo;
            </p>
            <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
              That frustration pointed to something bigger than a bad night
              out. Local restaurants and bars were already doing the hard
              part &mdash; creating experiences worth showing up for. What
              was missing wasn&rsquo;t better venues. It was an easy,
              reliable way for the people already looking for a good night
              out to actually find them.
            </p>
            <div className="mt-8 pl-5 border-l-4 border-amber-400">
              <p className="text-lg md:text-xl font-semibold text-gray-900 leading-snug">
                Local businesses were already creating experiences worth
                finding. What was missing was a simple, reliable way for
                people to discover them &mdash; and that gap is why Happy
                Hour Compass exists.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. What we believe ───────────────────────────────────────────
          Same three-card icon grid treatment as business/page.tsx
          PILLARS section ("Why Choose Happy Hour Compass"). */}
      <section className="bg-white">
        <div className="max-w-6xl mx-auto px-6 lg:px-10 py-16 md:py-24">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
              What We Believe
            </h2>
            <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
              A few simple principles guide everything we build.
            </p>
          </div>
          <div className="mt-14 grid sm:grid-cols-3 gap-6">
            {PRINCIPLES.map((principle) => (
              <div
                key={principle.id}
                className="rounded-2xl border border-gray-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.05)] p-8 md:p-10 text-center"
              >
                <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-50 ring-1 ring-amber-200/70 text-amber-700 items-center justify-center mb-6">
                  {principle.icon}
                </div>
                <h3 className="text-xl font-bold text-gray-900">{principle.title}</h3>
                <p className="mt-3 text-base text-gray-600 leading-relaxed">
                  {principle.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. Today ────────────────────────────────────────────────────── */}
      <section className="bg-gray-50">
        <div className="max-w-2xl mx-auto px-6 lg:px-10 py-16 md:py-24 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
            How We&rsquo;re Changing It
          </h2>
          <p className="mt-6 text-base md:text-lg text-gray-500 leading-relaxed">
            Happy Hour Compass is focused on one thing: connecting people
            with great local experiences, while helping the businesses that
            create them get discovered.
          </p>
          <p className="mt-4 text-base md:text-lg text-gray-500 leading-relaxed">
            For guests, that means one place to find real, up-to-date happy
            hours and events nearby &mdash; instead of piecing it together
            from five different sources. For local restaurants and bars, it
            means an easier way to reach people who are already deciding
            where to go tonight.
          </p>
          <p className="mt-6 text-lg md:text-xl font-semibold text-gray-900 leading-relaxed">
            We&rsquo;re just getting started, and there&rsquo;s a lot more to
            build. But the question that started it all hasn&rsquo;t
            changed &mdash; and we&rsquo;re working every day to make it
            easier to answer.
          </p>
        </div>
      </section>

      {/* ── 6. Final CTA ────────────────────────────────────────────────── */}
      <section className="bg-gray-900">
        <div className="max-w-3xl mx-auto px-6 lg:px-10 py-16 md:py-24 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            Ready to explore?
          </h2>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/" className={PRIMARY_CTA_CLASS}>
              Find Happy Hours
            </Link>
            <Link href="/business" className={SECONDARY_CTA_DARK_CLASS}>
              For Businesses
            </Link>
          </div>
        </div>
      </section>
      </div>
    </>
  );
}
