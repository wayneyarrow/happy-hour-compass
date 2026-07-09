import { createAdminClient } from "@/lib/supabase/server";
import { normalizeAppliesTo, type FaqLibraryItem, type GuideFaqAnswer } from "@/lib/data/faqLibraryTypes";
import { isGuidePublicNow } from "@/lib/data/contentGuides";

/**
 * Data helpers for the FAQ Library & Content Engine FAQ architecture
 * (Card 2C — see docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md).
 *
 * Architecture: questions belong to the library (faq_library); answers
 * belong to individual guides (content_guide_faqs); an optional related
 * guide belongs to an individual guide's answer (content_guide_faqs.
 * related_guide_id). See migration 057_faq_library.sql.
 *
 * Card 2C was the CMS foundation only. Card 2D (see docs/website/
 * CONTENT_ENGINE_PRODUCT_SPEC.md) adds public rendering: getGuideFaqs() is
 * called from both the public guide page and the Control Panel preview
 * route. Create/update/delete writes for the library live in
 * app/control-panel/content-engine/faq-library/actions.ts, and guide↔FAQ
 * writes live in app/control-panel/content-engine/actions.ts, following the
 * existing actions.ts convention (see contentGuideAttachments.ts).
 *
 * Internal-only tables (no RLS policies for anon/authenticated) — always
 * queried via createAdminClient() (service-role).
 *
 * Server-only: this file imports createAdminClient (which imports
 * next/headers via @/lib/supabase/server) and must never be imported by a
 * client component. Types and the pure faqAppliesTo() filter helper live in
 * the sibling faqLibraryTypes.ts (no server imports at all) — import from
 * there in any client component. Re-exported below so existing server-side
 * importers of this file don't need to change.
 */

export type { FaqAppliesTo, FaqLibraryItem, GuideFaqAnswer } from "@/lib/data/faqLibraryTypes";
export { faqAppliesTo } from "@/lib/data/faqLibraryTypes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFaqLibraryRow(row: Record<string, any>): FaqLibraryItem {
  return {
    id: row.id as string,
    question: row.question as string,
    category: (row.category as string | null) ?? null,
    applies_to: normalizeAppliesTo(row.applies_to as string),
    sort_order: row.sort_order as number,
    active: row.active as boolean,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

const FAQ_LIBRARY_COLUMNS = "id, question, category, applies_to, sort_order, active, created_at, updated_at";

// ── FAQ Library reads ──────────────────────────────────────────────────────────

/** All FAQ Library rows (active and inactive), for the Control Panel list page. */
export async function getFaqLibrary(): Promise<FaqLibraryItem[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("faq_library")
    .select(FAQ_LIBRARY_COLUMNS)
    .order("sort_order", { ascending: true })
    .order("question", { ascending: true });

  if (error) {
    console.error("[getFaqLibrary]", error.message);
    return [];
  }
  return (data ?? []).map(mapFaqLibraryRow);
}

/** Active-only FAQ Library rows, for the guide editor's question picker (Card 2C). */
export async function getActiveFaqLibrary(): Promise<FaqLibraryItem[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("faq_library")
    .select(FAQ_LIBRARY_COLUMNS)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getActiveFaqLibrary]", error.message);
    return [];
  }
  return (data ?? []).map(mapFaqLibraryRow);
}

export async function getFaqLibraryItemById(id: string): Promise<FaqLibraryItem | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("faq_library")
    .select(FAQ_LIBRARY_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return mapFaqLibraryRow(data);
}

/**
 * Whether any guide currently uses this library question. Gates the
 * Control Panel's "delete only if unused" rule — the DB's own
 * ON DELETE RESTRICT (migration 057) is a backstop if this check is ever
 * bypassed, but the UI should never let an admin attempt (and fail) a
 * delete it can predict will be rejected.
 */
export async function isFaqInUse(faqId: string): Promise<boolean> {
  const supabase = createAdminClient();

  const { count, error } = await supabase
    .from("content_guide_faqs")
    .select("id", { count: "exact", head: true })
    .eq("faq_id", faqId);

  if (error) {
    console.error("[isFaqInUse]", error.message);
    // Fail safe: an unreadable usage count blocks deletion rather than
    // silently allowing one that might violate the DB's RESTRICT constraint.
    return true;
  }
  return (count ?? 0) > 0;
}

// ── Guide ↔ FAQ relationship (content_guide_faqs) ───────────────────────────────

/**
 * A guide's saved FAQ answers, ordered, with the library question and any
 * related guide's title/URL joined in for display. related_guide_id has no
 * market constraint (a related guide may live in a different market than
 * the guide being viewed), so the related guide's own market slug is
 * fetched alongside its slug — never assume the current guide's marketSlug.
 * relatedGuideSlug/relatedGuideMarketSlug/relatedGuideTitle are only
 * populated when the related guide is actually public right now (published
 * + in its publish window, via isGuidePublicNow — same predicate the public
 * guide page itself is gated on), so a guide can never link to a draft or
 * expired guide. Every row returned here has a non-empty question and
 * answer by construction: saveGuideFaqs() only ever persists rows that had
 * both at save time (see that function's docstring), so callers never need
 * to defensively filter for "complete" FAQs — this whole array is complete.
 */
export async function getGuideFaqs(guideId: string): Promise<GuideFaqAnswer[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("content_guide_faqs")
    .select(
      "faq_id, answer, related_guide_id, display_order, " +
        "faq:faq_library(question, applies_to), " +
        "related_guide:content_guides!content_guide_faqs_related_guide_id_fkey(title, slug, status, publish_at, expire_at, markets(slug))"
    )
    .eq("guide_id", guideId)
    .order("display_order", { ascending: true });

  if (error) {
    console.error("[getGuideFaqs]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: Record<string, any>) => {
    const faq = (row.faq as Record<string, unknown> | null) ?? null;
    const relatedGuide = (row.related_guide as Record<string, unknown> | null) ?? null;

    let relatedGuideTitle: string | null = null;
    let relatedGuideSlug: string | null = null;
    let relatedGuideMarketSlug: string | null = null;

    if (relatedGuide) {
      const isPublic = isGuidePublicNow(
        (relatedGuide.status as string | undefined) ?? "draft",
        (relatedGuide.publish_at as string | null) ?? null,
        (relatedGuide.expire_at as string | null) ?? null
      );
      const marketSlug = (relatedGuide.markets as Record<string, unknown> | null)?.slug as
        | string
        | undefined;
      if (isPublic && marketSlug) {
        relatedGuideTitle = (relatedGuide.title as string | undefined) ?? null;
        relatedGuideSlug = (relatedGuide.slug as string | undefined) ?? null;
        relatedGuideMarketSlug = marketSlug;
      }
    }

    return {
      faqId: row.faq_id as string,
      question: (faq?.question as string | undefined) ?? "(question no longer available)",
      appliesTo: normalizeAppliesTo((faq?.applies_to as string | undefined) ?? "both"),
      answer: row.answer as string,
      relatedGuideId: (row.related_guide_id as string | null) ?? null,
      relatedGuideTitle,
      relatedGuideSlug,
      relatedGuideMarketSlug,
      displayOrder: row.display_order as number,
    };
  });
}

/**
 * Replaces a guide's FAQ answers wholesale — same delete-then-reinsert
 * pattern as saveGuideAttachments (contentGuideAttachments.ts). Rows
 * missing a question or answer are silently dropped rather than blocking
 * the whole guide save (mirrors editorial sections being optional, Card
 * 2A). Duplicate faqIds are de-duped (last one wins) so a submission can
 * never violate the DB's unique(guide_id, faq_id) constraint.
 */
export async function saveGuideFaqs(
  guideId: string,
  items: { faqId: string; answer: string; relatedGuideId: string | null }[]
): Promise<void> {
  const supabase = createAdminClient();

  const byFaqId = new Map<string, { faqId: string; answer: string; relatedGuideId: string | null }>();
  for (const item of items) {
    if (!item.faqId || !item.answer.trim()) continue;
    byFaqId.set(item.faqId, item);
  }
  const clean = [...byFaqId.values()];

  const { error: clearError } = await supabase
    .from("content_guide_faqs")
    .delete()
    .eq("guide_id", guideId);
  if (clearError) {
    console.error("[saveGuideFaqs] Failed clearing existing rows:", clearError.message);
    return;
  }

  if (clean.length === 0) return;

  const rows = clean.map((item, index) => ({
    guide_id: guideId,
    faq_id: item.faqId,
    answer: item.answer.trim(),
    related_guide_id: item.relatedGuideId || null,
    display_order: index,
  }));

  const { error: insertError } = await supabase.from("content_guide_faqs").insert(rows);
  if (insertError) {
    console.error("[saveGuideFaqs] Failed inserting rows:", insertError.message);
  }
}
