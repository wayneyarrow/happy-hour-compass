/**
 * FAQPage JSON-LD structured data (Card 2D — see docs/website/
 * CONTENT_ENGINE_PRODUCT_SPEC.md).
 *
 * Schema.org FAQPage: https://schema.org/FAQPage. Question text comes from
 * the FAQ library; answer text is the guide-specific answer only — the
 * "Read next: {title}" related-guide link is rendered separately in the
 * page markup and is never appended to the schema's answer text.
 *
 * Every GuideFaqAnswer returned by getGuideFaqs() already has a non-empty
 * question and answer (saveGuideFaqs() only ever persists complete rows —
 * see faqLibrary.ts), so no completeness filtering happens here. This is
 * the first JSON-LD helper in the codebase — src/lib/seo/metadata.ts's
 * "Phase 3: JSON-LD structured data" note anticipated it.
 */

import type { GuideFaqAnswer } from "@/lib/data/faqLibraryTypes";

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

/** Returns FAQPage JSON-LD for a guide's FAQs, or null when there are none to emit. */
export function buildFaqPageSchema(faqs: GuideFaqAnswer[]): FaqPageSchema | null {
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
