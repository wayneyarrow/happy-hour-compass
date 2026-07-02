"use server";

import { revalidatePath } from "next/cache";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { logAuditEvent } from "@/lib/auditLog";
import {
  isDistributionChannelKey,
  type DistributionChannelKey,
} from "@/lib/data/contentGuideDistributionShared";

/**
 * Discover Management → Guides merchandising server actions (Card 6B).
 *
 * Deliberately isolated from ../actions.ts (the existing venue/event rail
 * actions) — this file only ever touches content_guide_placements, never
 * discover_rail_overrides or the venues/events tables, per the card's
 * "do not refactor the existing venue/event Discover Management
 * implementation" guardrail.
 *
 * Every action re-validates that a placement can only exist for a
 * (guide_id, channel_key) pair Content Engine has already marked eligible —
 * though the composite FK in migration 055 makes this a DB guarantee
 * regardless, an insert against a non-eligible pair fails at the DB level
 * and is reported back as a normal error, not a crash.
 */

type ActionResult = { success: boolean; error?: string };

// ─── Shared auth helper — mirrors ../actions.ts's getAdmin() ─────────────────

async function getCallerEmail(): Promise<string | null> {
  try {
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user?.email) return null;
    if (!(await isControlPanelAdmin(user.email))) return null;
    return user.email;
  } catch {
    return null;
  }
}

function parseChannel(channelKey: string): DistributionChannelKey | null {
  return isDistributionChannelKey(channelKey) ? channelKey : null;
}

// ─── Add to channel (merchandise) ────────────────────────────────────────────

export async function addGuidePlacementAction(
  guideId: string,
  channelKeyRaw: string
): Promise<ActionResult> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { success: false, error: "Unauthorized." };

  const channelKey = parseChannel(channelKeyRaw);
  if (!channelKey) return { success: false, error: "Unknown distribution channel." };

  const supabase = createAdminClient();

  const { data: maxRow } = await supabase
    .from("content_guide_placements")
    .select("sort_order")
    .eq("channel_key", channelKey)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;

  const { error } = await supabase.from("content_guide_placements").insert({
    guide_id: guideId,
    channel_key: channelKey,
    sort_order: nextSortOrder,
    is_active: true,
    created_by: callerEmail,
    updated_by: callerEmail,
  });

  if (error) {
    console.error("[addGuidePlacementAction]", error.message);
    return {
      success: false,
      error: "Failed to add this guide to the channel — it may no longer be eligible.",
    };
  }

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "content_guide_placement_added",
    entityType: "content_guide",
    entityId: guideId,
    entityName: channelKey,
  });

  revalidatePath("/control-panel/discover/guides");
  return { success: true };
}

// ─── Remove from channel (un-merchandise, eligibility untouched) ────────────

export async function removeGuidePlacementAction(
  guideId: string,
  channelKeyRaw: string
): Promise<ActionResult> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { success: false, error: "Unauthorized." };

  const channelKey = parseChannel(channelKeyRaw);
  if (!channelKey) return { success: false, error: "Unknown distribution channel." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("content_guide_placements")
    .delete()
    .eq("guide_id", guideId)
    .eq("channel_key", channelKey);

  if (error) {
    console.error("[removeGuidePlacementAction]", error.message);
    return { success: false, error: "Failed to remove this guide from the channel." };
  }

  await logAuditEvent({
    actorEmail: callerEmail,
    action: "content_guide_placement_removed",
    entityType: "content_guide",
    entityId: guideId,
    entityName: channelKey,
  });

  revalidatePath("/control-panel/discover/guides");
  return { success: true };
}

// ─── Active / inactive toggle ────────────────────────────────────────────────

export async function toggleGuidePlacementActiveAction(
  guideId: string,
  channelKeyRaw: string,
  isActive: boolean
): Promise<ActionResult> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { success: false, error: "Unauthorized." };

  const channelKey = parseChannel(channelKeyRaw);
  if (!channelKey) return { success: false, error: "Unknown distribution channel." };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("content_guide_placements")
    .update({ is_active: isActive, updated_by: callerEmail })
    .eq("guide_id", guideId)
    .eq("channel_key", channelKey);

  if (error) {
    console.error("[toggleGuidePlacementActiveAction]", error.message);
    return { success: false, error: "Failed to update this guide's active state." };
  }

  revalidatePath("/control-panel/discover/guides");
  return { success: true };
}

// ─── Reorder (swap with adjacent placement) ─────────────────────────────────

export async function moveGuidePlacementAction(
  channelKeyRaw: string,
  marketId: string,
  guideId: string,
  direction: -1 | 1
): Promise<ActionResult> {
  const callerEmail = await getCallerEmail();
  if (!callerEmail) return { success: false, error: "Unauthorized." };

  const channelKey = parseChannel(channelKeyRaw);
  if (!channelKey) return { success: false, error: "Unknown distribution channel." };

  const supabase = createAdminClient();

  // All placements for this channel within this market, in current order —
  // reordering is scoped to the market being managed, consistent with the
  // rest of the Guides merchandising page.
  const { data, error } = await supabase
    .from("content_guide_placements")
    .select("guide_id, sort_order, content_guides!inner(market_id)")
    .eq("channel_key", channelKey)
    .eq("content_guides.market_id", marketId)
    .order("sort_order", { ascending: true });

  if (error || !data) {
    console.error("[moveGuidePlacementAction]", error?.message);
    return { success: false, error: "Failed to load current order." };
  }

  const rows = data as { guide_id: string; sort_order: number }[];
  const index = rows.findIndex((r) => r.guide_id === guideId);
  const targetIndex = index + direction;
  if (index === -1 || targetIndex < 0 || targetIndex >= rows.length) {
    return { success: false, error: "Cannot move further in that direction." };
  }

  const current = rows[index];
  const neighbor = rows[targetIndex];

  const [{ error: err1 }, { error: err2 }] = await Promise.all([
    supabase
      .from("content_guide_placements")
      .update({ sort_order: neighbor.sort_order, updated_by: callerEmail })
      .eq("guide_id", current.guide_id)
      .eq("channel_key", channelKey),
    supabase
      .from("content_guide_placements")
      .update({ sort_order: current.sort_order, updated_by: callerEmail })
      .eq("guide_id", neighbor.guide_id)
      .eq("channel_key", channelKey),
  ]);

  if (err1 || err2) {
    console.error("[moveGuidePlacementAction] swap failed", err1?.message, err2?.message);
    return { success: false, error: "Failed to reorder." };
  }

  revalidatePath("/control-panel/discover/guides");
  return { success: true };
}
