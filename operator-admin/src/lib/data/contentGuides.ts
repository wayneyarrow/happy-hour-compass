import { createAdminClient } from "@/lib/supabase/server";

/**
 * Data helpers for the Content Engine foundation (content_guides table).
 *
 * See docs/website/CONTENT_ENGINE_PRODUCT_SPEC.md. This is Card 1 /
 * foundation only — list read access for the Control Panel shell. The guide
 * editor, publishing workflow, and public rendering are later cards.
 *
 * Internal-only table (no RLS policies for anon/authenticated) — always
 * queried via createAdminClient() (service-role).
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type GuideType = "venue_guide" | "event_guide";
export type GuideStatus = "draft" | "scheduled" | "published" | "expired";

export type ContentGuideRow = {
  id: string;
  guide_type: GuideType;
  status: GuideStatus;
  title: string;
  slug: string;
  marketName: string | null;
  cityName: string | null;
  publish_at: string | null;
  updated_at: string;
};

// ── Queries ───────────────────────────────────────────────────────────────────

/** Returns all content guides, newest-updated first, for the Content Engine list page. */
export async function getContentGuides(): Promise<ContentGuideRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("content_guides")
    .select(
      "id, guide_type, status, title, slug, publish_at, updated_at, " +
        "market:markets(name), city:cities(name)"
    )
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[getContentGuides]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: Record<string, any>) => ({
    id:          row.id as string,
    guide_type:  row.guide_type as GuideType,
    status:      row.status as GuideStatus,
    title:       row.title as string,
    slug:        row.slug as string,
    marketName:  (row.market?.name as string | undefined) ?? null,
    cityName:    (row.city?.name as string | undefined) ?? null,
    publish_at:  row.publish_at as string | null,
    updated_at:  row.updated_at as string,
  }));
}
