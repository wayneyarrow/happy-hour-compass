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
 * see faqLibrary.ts), so no completeness filtering happens here. This is
 * the first JSON-LD helper in the codebase — src/lib/seo/metadata.ts's
 * "Phase 3: JSON-LD structured data" note anticipated it.
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
