import { createAdminClient } from "@/lib/supabase/server";
import { getMarketBySlug } from "@/lib/geo/geography";
import { isGuidePublicNow, type GuideType, type GuideStatus } from "@/lib/data/contentGuides";
import {
  isDistributionChannelKey,
  type DistributionChannelKey,
} from "@/lib/data/contentGuideDistributionShared";

/**
 * Server-only data helpers for Content Engine guide distribution (Card 6B).
 *
 * Two concerns, two tables, matching migration 055's design:
 *   - content_guide_channels   — Content Engine's eligibility (this file's
 *     getGuideChannels/saveGuideChannels, called from the guide editor).
 *   - content_guide_placements — Discover Management's merchandising (this
 *     file's getMerchandisableGuides + the public reads at the bottom,
 *     called from the CP Guides page and the public website respectively).
 *
 * All internal-only tables — always queried via createAdminClient()
 * (service-role), consistent with contentGuides.ts / contentGuideAttachments.ts.
 */

// ── Eligibility (Content Engine) ─────────────────────────────────────────────

/** Returns the channel keys a guide is currently marked eligible for. */
export async function getGuideChannels(guideId: string): Promise<DistributionChannelKey[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("content_guide_channels")
    .select("channel_key")
    .eq("guide_id", guideId);

  if (error) {
    console.error("[getGuideChannels]", error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => row.channel_key as string)
    .filter(isDistributionChannelKey);
}

/**
 * Replaces a guide's eligible channel set. Delete-then-insert, same
 * rationale as saveGuideAttachments (Card 3): the set is tiny (currently at
 * most 2 channels), so a full replace on every save is simpler than diffing
 * and just as correct.
 *
 * Revoking eligibility (a channel no longer in `channelKeys`) automatically
 * removes any existing merchandising placement for that channel via the
 * composite FK's ON DELETE CASCADE (migration 055) — Discover Management
 * can never keep merchandising something Content Engine has un-eligible'd.
 *
 * Unknown channel keys are silently dropped (defense in depth — the editor
 * UI only ever offers known channels, but this is the last line before the
 * DB, which has no CHECK constraint on channel_key by design).
 */
export async function saveGuideChannels(
  guideId: string,
  channelKeys: string[]
): Promise<void> {
  const supabase = createAdminClient();
  const validKeys = channelKeys.filter(isDistributionChannelKey);

  const { error: deleteError } = await supabase
    .from("content_guide_channels")
    .delete()
    .eq("guide_id", guideId);
  if (deleteError) {
    console.error("[saveGuideChannels] Failed clearing existing channels:", deleteError.message);
    return;
  }

  if (validKeys.length === 0) return;

  const { error: insertError } = await supabase
    .from("content_guide_channels")
    .insert(validKeys.map((channel_key) => ({ guide_id: guideId, channel_key })));
  if (insertError) {
    console.error("[saveGuideChannels] Failed inserting channels:", insertError.message);
  }
}

// ── Merchandising (Discover Management) ──────────────────────────────────────

export type MerchandisableGuide = {
  guideId: string;
  title: string;
  slug: string;
  guideType: GuideType;
  status: GuideStatus;
  heroImageUrl: string | null;
  isMerchandised: boolean;
  sortOrder: number;
  isActive: boolean;
};

/**
 * Returns every guide eligible for `channelKey` in `marketId`, merged with
 * its current placement (if any). Guides with no placement row appear with
 * isMerchandised: false so Discover Management can add them; guides that
 * are already merchandised are sorted first, by sort_order.
 *
 * Two queries + an in-memory merge rather than one embedded query — a plain
 * left join (eligible guides that may or may not have a placement) isn't a
 * natural fit for PostgREST's embedded-resource filtering, and the guide
 * counts here are small enough that this is simpler and just as fast.
 */
export async function getMerchandisableGuides(
  channelKey: DistributionChannelKey,
  marketId: string
): Promise<MerchandisableGuide[]> {
  const supabase = createAdminClient();

  const { data: eligibleRows, error: eligibleError } = await supabase
    .from("content_guide_channels")
    .select(
      "guide_id, content_guides!inner(id, title, slug, guide_type, status, hero_image_url, market_id)"
    )
    .eq("channel_key", channelKey)
    .eq("content_guides.market_id", marketId);

  if (eligibleError) {
    console.error("[getMerchandisableGuides]", eligibleError.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eligible = (eligibleRows ?? []).map((row: Record<string, any>) => {
    const guide = row.content_guides as Record<string, unknown>;
    return {
      guideId: guide.id as string,
      title: guide.title as string,
      slug: guide.slug as string,
      guideType: guide.guide_type as GuideType,
      status: guide.status as GuideStatus,
      heroImageUrl: (guide.hero_image_url as string | null) ?? null,
    };
  });

  if (eligible.length === 0) return [];

  const guideIds = eligible.map((g) => g.guideId);
  const { data: placementRows, error: placementError } = await supabase
    .from("content_guide_placements")
    .select("guide_id, sort_order, is_active")
    .eq("channel_key", channelKey)
    .in("guide_id", guideIds);

  if (placementError) {
    console.error("[getMerchandisableGuides] placements:", placementError.message);
  }

  const placementByGuideId = new Map(
    (placementRows ?? []).map((p) => [p.guide_id as string, p])
  );

  const merged: MerchandisableGuide[] = eligible.map((g) => {
    const placement = placementByGuideId.get(g.guideId);
    return {
      ...g,
      isMerchandised: Boolean(placement),
      sortOrder: (placement?.sort_order as number | undefined) ?? 0,
      isActive: (placement?.is_active as boolean | undefined) ?? false,
    };
  });

  merged.sort((a, b) => {
    if (a.isMerchandised !== b.isMerchandised) return a.isMerchandised ? -1 : 1;
    if (a.isMerchandised) return a.sortOrder - b.sortOrder;
    return a.title.localeCompare(b.title);
  });

  return merged;
}

// ── Public reads (website) ───────────────────────────────────────────────────

export type PublicGuideCardData = {
  title: string;
  slug: string;
  guideType: GuideType;
  heroImageUrl: string | null;
};

/**
 * Shared by getGuideLibraryForMarket and getFeaturedGuidesForMarket — both
 * enforce the exact same rule set from Card 6B Part 5: published, inside
 * publish window, eligible (implicit — a placement can't exist without
 * eligibility, per the composite FK), and actively merchandised.
 * isGuidePublicNow() (contentGuides.ts) is reused rather than
 * re-implemented, per Part 5's "do not duplicate publishing logic."
 */
async function getMerchandisedPublicGuides(
  channelKey: DistributionChannelKey,
  marketSlug: string
): Promise<PublicGuideCardData[]> {
  const market = await getMarketBySlug(marketSlug);
  if (!market) return [];

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("content_guide_placements")
    .select(
      "sort_order, " +
        "content_guides!inner(title, slug, guide_type, status, hero_image_url, publish_at, expire_at, market_id)"
    )
    .eq("channel_key", channelKey)
    .eq("is_active", true)
    .eq("content_guides.status", "published")
    .eq("content_guides.market_id", market.id)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error(`[getMerchandisedPublicGuides:${channelKey}]`, error.message);
    return [];
  }

  return (data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((row: Record<string, any>) => row.content_guides as Record<string, any>)
    .filter((g) =>
      isGuidePublicNow(
        g.status as string,
        (g.publish_at as string | null) ?? null,
        (g.expire_at as string | null) ?? null
      )
    )
    .map((g) => ({
      title: g.title as string,
      slug: g.slug as string,
      guideType: g.guide_type as GuideType,
      heroImageUrl: (g.hero_image_url as string | null) ?? null,
    }));
}

/** Powers the public /{market}/guides library — the canonical destination (Part 4). */
export async function getGuideLibraryForMarket(marketSlug: string): Promise<PublicGuideCardData[]> {
  return getMerchandisedPublicGuides("guides_library", marketSlug);
}

/**
 * Powers the website homepage's Featured Guides rail — a curated subset of
 * the same merchandising data the library uses, per Part 4 ("Homepage
 * simply surfaces a curated subset").
 */
export async function getFeaturedGuidesForMarket(
  marketSlug: string,
  limit = 4
): Promise<PublicGuideCardData[]> {
  const guides = await getMerchandisedPublicGuides("market_homepage", marketSlug);
  return guides.slice(0, limit);
}
