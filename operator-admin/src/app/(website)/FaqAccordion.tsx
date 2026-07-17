import type { ReactNode } from "react";
import { buildFaqPageSchema } from "@/lib/seo/schema/faq";

/**
 * Generalized public FAQ accordion (Card 2D — see docs/website/
 * CONTENT_ENGINE_PRODUCT_SPEC.md). Originally guide-specific
 * (GuideFaqSection.tsx); pulled up here so any website page with a static
 * or DB-backed FAQ list — guides, the business page, future business pages
 * — renders the same accordion and emits the same FAQPage JSON-LD instead
 * of each page hand-rolling its own.
 *
 * Server component. Renders nothing when `items` is empty.
 *
 * Accordion uses native <details>/<summary> rather than a client component
 * with useState: the browser manages open/closed state, keyboard access,
 * and aria-expanded on the implicit button role of <summary> for free, and
 * every answer stays present in the HTML (and visible to crawlers) whether
 * expanded or not, with zero extra client JS.
 */

export type FaqAccordionItem = {
  id: string;
  question: string;
  answer: string;
  /** Optional content appended after the answer — e.g. a "Read more" related-guide link. */
  afterAnswer?: ReactNode;
};

type Props = {
  items: FaqAccordionItem[];
  heading?: string;
  /** Optional supporting sentence rendered directly beneath the heading. */
  description?: string;
  /** Set false to skip emitting FAQPage JSON-LD (e.g. if a page already emits its own). */
  includeSchema?: boolean;
};

export function FaqAccordion({
  items,
  heading = "Frequently Asked Questions",
  description,
  includeSchema = true,
}: Props) {
  if (items.length === 0) return null;

  const schema = includeSchema ? buildFaqPageSchema(items) : null;

  return (
    <section className="mb-12 pt-10 md:pt-12 border-t border-gray-100">
      <h2 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight leading-snug">
        {heading}
      </h2>
      {description && (
        <p className="mt-3 text-base text-gray-500 leading-relaxed">{description}</p>
      )}
      <div className="mt-8 rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
        {items.map((item) => (
          <details key={item.id} className="group px-5 py-4 sm:px-6 sm:py-5">
            <summary
              className="flex items-center justify-between gap-4 cursor-pointer list-none font-semibold text-gray-900 [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-lg"
            >
              <span>{item.question}</span>
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
              {item.answer}
              {item.afterAnswer}
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
