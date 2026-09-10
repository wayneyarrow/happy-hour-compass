import { createAdminClient } from "@/lib/supabase/server";
import type { AttachmentCandidate, MatchTier } from "@/lib/data/contentGuideAttachments";

/**
 * Daily Special override-picker search, for the Today's Specials Collection
 * editor's "Add" search (ResolvedCollectionTable.tsx via
 * searchCollectionDailySpecialCandidatesAction, control-panel/collections/
 * actions.ts). Returns the same AttachmentCandidate shape
 * searchVenueCandidates/searchEventCandidates (contentGuideAttachments.ts)
 * already use, so the existing Collections search-and-add UI works
 * unmodified for this content type too.
 *
 * Deliberately simpler than contentGuideAttachments.ts's tiered
 * neighbourhood/city/market cascade: a Daily Special's own geography is
 * always its parent venue's (no neighbourhood granularity is needed here),
 * and a founder using this picker already knows they're overriding within
 * one specific Collection's fixed market/city — a single query scoped to
 * that exact geography, ordered by title, is enough to "not make it
 * impossible to locate a valid eligible Special" (this task's requirement)
 * without a second full cascading-tier implementation.
 *
 * Only published Specials belonging to a published venue are ever
 * returned — draft/unpublished content is never selectable here, matching
 * the "never surface draft/unpublished Specials as selectable consumer
 * overrides" rule. "Today"-eligibility is intentionally NOT filtered here:
 * a founder must be able to find and Include a Special that is eligible
 * today but currently ranked outside the natural top six (this task's
 * explicit requirement) — eligibility-today is enforced later, at
 * selection time (selectTodaysSpecials), not at search time.
 */
export async function searchDailySpecialCandidates(params: {
  marketId: string;
  cityId: string | null;
  query?: string;
  excludeIds?: string[];
  limit?: number;
}): Promise<AttachmentCandidate[]> {
  const limit = params.limit ?? 20;
  const supabase = createAdminClient();

  let query = supabase
    .from("daily_specials")
    .select("id, title, venue:venues!inner(name, market_id, city_id, is_published)")
    .eq("is_published", true)
    .eq("venues.is_published", true)
    .eq("venues.market_id", params.marketId);

  if (params.cityId) query = query.eq("venues.city_id", params.cityId);
  if (params.query?.trim()) query = query.ilike("title", `%${params.query.trim()}%`);
  if (params.excludeIds && params.excludeIds.length > 0) {
    query = query.not("id", "in", `(${params.excludeIds.join(",")})`);
  }

  const { data, error } = await query.order("title", { ascending: true }).limit(limit);
  if (error) {
    console.error("[searchDailySpecialCandidates]", error.message);
    return [];
  }

  const tier: MatchTier = params.cityId ? "city" : "market";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: Record<string, any>) => {
    const venue = (row.venue as Record<string, unknown> | null) ?? {};
    return {
      id: row.id as string,
      primaryLabel: row.title as string,
      secondaryLabel: (venue.name as string | undefined) ?? null,
      matchTier: tier,
    };
  });
}
