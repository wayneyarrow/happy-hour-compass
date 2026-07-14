import Link from "next/link";
import { FaqAccordion, type FaqAccordionItem } from "@/app/(website)/FaqAccordion";
import type { GuideFaqAnswer } from "@/lib/data/faqLibraryTypes";

/**
 * Public guide FAQ rendering (Card 2D — see docs/website/
 * CONTENT_ENGINE_PRODUCT_SPEC.md). Shared by the public guide page and the
 * Control Panel preview route (both pass the same GuideFaqAnswer[] from
 * getGuideFaqs()), so the two surfaces can never visually drift apart —
 * same pattern as GuideDetailView itself.
 *
 * Thin wrapper around the generic FaqAccordion: adds the guide-specific
 * "Read next: {title}" related-guide link after each answer, and lets
 * FaqAccordion own the actual accordion markup and JSON-LD.
 */

type Props = {
  faqs: GuideFaqAnswer[];
};

export function GuideFaqSection({ faqs }: Props) {
  const items: FaqAccordionItem[] = faqs.map((faq) => ({
    id: faq.faqId,
    question: faq.question,
    answer: faq.answer,
    afterAnswer:
      faq.relatedGuideSlug && faq.relatedGuideMarketSlug ? (
        <p className="mt-3">
          Looking for more? Explore our guide to{" "}
          <Link
            href={`/${faq.relatedGuideMarketSlug}/guides/${faq.relatedGuideSlug}`}
            className="font-medium text-amber-600 hover:text-amber-700 transition-colors"
          >
            {faq.relatedGuideTitle} →
          </Link>
        </p>
      ) : undefined,
  }));

  return <FaqAccordion items={items} />;
}
