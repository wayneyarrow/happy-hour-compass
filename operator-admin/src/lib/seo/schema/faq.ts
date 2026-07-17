/**
 * FAQPage JSON-LD structured data (Card 2D — see docs/website/
 * CONTENT_ENGINE_PRODUCT_SPEC.md).
 *
 * Schema.org FAQPage: https://schema.org/FAQPage. The "Read next: {title}"
 * related-guide link (where applicable) is rendered separately in the page
 * markup and is never appended to the schema's answer text.
 *
 * Takes any question/answer shape structurally — GuideFaqAnswer[] (guide
 * FAQs) and FaqAccordionItem[] (e.g. the business page's static FAQs) both
 * satisfy FaqEntry[] as-is, so neither call site needs to reshape its data.
 * Every GuideFaqAnswer returned by getGuideFaqs() already has a non-empty
 * question and answer (saveGuideFaqs() only ever persists complete rows —
 * see faqLibrary.ts), so no completeness filtering happens here. This was
 * the first JSON-LD helper in the codebase — originally
 * src/lib/seo/faqSchema.ts, relocated here as the first entry in the
 * shared src/lib/seo/schema/ structured-data foundation. Deliberately
 * unchanged in shape: it still returns a complete, self-contained
 * "@context"+"@type" object rather than a bare SchemaNode (see types.ts),
 * since FaqAccordion.tsx renders it via its own <script> tag rather than
 * through the shared JsonLd component — normalizing that is a separate,
 * later task, not a foundation change.
 */

export type FaqEntry = { question: string; answer: string };

export type FaqPageSchema = {
  "@context": "https://schema.org";
  "@type": "FAQPage";
  mainEntity: {
    "@type": "Question";
    name: string;
    acceptedAnswer: {
      "@type": "Answer";
      text: string;
    };
  }[];
};

/** Returns FAQPage JSON-LD for a set of FAQs, or null when there are none to emit. */
export function buildFaqPageSchema(faqs: FaqEntry[]): FaqPageSchema | null {
  if (faqs.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}
