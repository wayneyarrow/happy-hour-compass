import Link from "next/link";
import type { GuideFaqAnswer } from "@/lib/data/faqLibraryTypes";
import { buildFaqPageSchema } from "@/lib/seo/faqSchema";

/**
 * Public FAQ rendering (Card 2D — see docs/website/
 * CONTENT_ENGINE_PRODUCT_SPEC.md). Shared by the public guide page and the
 * Control Panel preview route (both pass the same GuideFaqAnswer[] from
 * getGuideFaqs()), so the two surfaces can never visually drift apart —
 * same pattern as GuideDetailView itself.
 *
 * Renders nothing when the guide has no FAQs (isGuidePublicNow already
 * guarantees every faq here has a complete question + answer — see
 * getGuideFaqs()'s docstring).
 *
 * Accordion uses native <details>/<summary> rather than a client component
 * with useState: the browser manages open/closed state, keyboard access,
 * and aria-expanded on the implicit button role of <summary> for free, and
 * every answer stays present in the HTML (and visible to crawlers) whether
 * expanded or not — exactly what "answers must remain available in the
 * HTML for SEO/accessibility" requires, with zero extra client JS.
 *
 * The FAQPage JSON-LD script is emitted here too (not in the page-level
 * generateMetadata) so both the public page and the preview route get it
 * automatically from one place. This is safe for preview: /control-panel is
 * auth-gated and noindexed (robots.ts + this route's own `robots: {index:
 * false}` metadata), so inert JSON-LD there has no indexing effect.
 */

type Props = {
  faqs: GuideFaqAnswer[];
};

export function GuideFaqSection({ faqs }: Props) {
  if (faqs.length === 0) return null;

  const schema = buildFaqPageSchema(faqs);

  return (
    <section className="mb-12 pt-10 md:pt-12 border-t border-gray-100">
      <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight leading-snug">
        Frequently Asked Questions
      </h2>
      <div className="mt-6 rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
        {faqs.map((faq) => (
          <details key={faq.faqId} className="group px-5 py-4 sm:px-6 sm:py-5">
            <summary
              className="flex items-center justify-between gap-4 cursor-pointer list-none font-semibold text-gray-900 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-lg"
            >
              <span>{faq.question}</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4 shrink-0 text-gray-400 transition-transform duration-200 group-open:rotate-180"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="mt-3 text-[15px] text-gray-600 leading-relaxed whitespace-pre-wrap">
              {faq.answer}
              {faq.relatedGuideSlug && faq.relatedGuideMarketSlug && (
                <p className="mt-3">
                  Looking for more? Explore our guide to{" "}
                  <Link
                    href={`/${faq.relatedGuideMarketSlug}/guides/${faq.relatedGuideSlug}`}
                    className="font-medium text-amber-600 hover:text-amber-700 transition-colors"
                  >
                    {faq.relatedGuideTitle} →
                  </Link>
                </p>
              )}
            </div>
          </details>
        ))}
      </div>
      {schema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      )}
    </section>
  );
}
