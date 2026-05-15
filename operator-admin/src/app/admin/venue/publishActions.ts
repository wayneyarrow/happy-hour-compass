"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import {
  computeVenueReadiness,
  computeOperatorImageCount,
} from "@/lib/venueReadiness";

// ── Venue row shape for readiness computation ─────────────────────────────────

type VenueForReadiness = {
  name: string | null;
  address_line1: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  phone: string | null;
  website_url: string | null;
  menu_url: string | null;
  establishment_type: string | null;
  hh_times: string | null;
  hh_tagline: string | null;
  hh_food_details: string | null;
  hh_drink_details: string | null;
  business_hours: Record<string, unknown> | null;
  payment_types: string | null;
  claimed_at: string | null;
};

// ── Image row shape ───────────────────────────────────────────────────────────

type MediaRow = {
  id: string;
  url: string;
};

// ── Action ────────────────────────────────────────────────────────────────────

export async function updatePublishStatusAction(
  venueId: string,
  isPublished: boolean
): Promise<{ error: string | null; missingRequired?: string[] }> {
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return { error: ctx.operatorError ?? "Could not resolve operator context." };
  }

  // Readiness check only applies when publishing — never when unpublishing.
  if (isPublished) {
    // ── Fetch venue row for readiness computation ───────────────────────────
    let venueQuery = ctx.supabase
      .from("venues")
      .select(
        "name, address_line1, city, region, postal_code, phone, website_url, menu_url, " +
          "establishment_type, hh_times, hh_tagline, hh_food_details, hh_drink_details, " +
          "business_hours, payment_types, claimed_at"
      )
      .eq("id", venueId);

    if (ctx.operator) {
      venueQuery = venueQuery.eq("created_by_operator_id", ctx.operator.id);
    }

    const { data: venueData, error: venueError } = await venueQuery.maybeSingle();

    if (venueError || !venueData) {
      return { error: "Venue not found or you don't have permission to edit it." };
    }

    const venue = venueData as unknown as VenueForReadiness;

    // ── Fetch image data for readiness ──────────────────────────────────────
    const { data: imageData } = await ctx.supabase
      .from("media")
      .select("id, url")
      .eq("venue_id", venueId)
      .eq("type", "venue_image");

    const allImages = (imageData as MediaRow[] | null) ?? [];
    const imageCount = allImages.length;
    const operatorImageCount = computeOperatorImageCount(
      allImages,
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
    );

    // ── Compute readiness ───────────────────────────────────────────────────
    const readiness = computeVenueReadiness({
      ...venue,
      imageCount,
      operatorImageCount,
    });

    if (!readiness.publishReady) {
      const labels = readiness.missingRequired.map((item) => item.label);
      return {
        error: `Complete the following before publishing: ${labels.join(", ")}.`,
        missingRequired: readiness.missingRequired.map((item) => item.key),
      };
    }
  }

  // ── Update publish status ─────────────────────────────────────────────────

  const updates: Record<string, unknown> = {
    is_published: isPublished,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  let q = ctx.supabase
    .from("venues")
    .update(updates, { count: "exact" })
    .eq("id", venueId);

  if (ctx.operator) {
    q = q.eq("created_by_operator_id", ctx.operator.id);
  }

  const { error, count } = await q;

  if (error) {
    console.error("[updatePublishStatusAction] Update failed:", error);
    return { error: `Failed to save: ${error.message}` };
  }

  if (count === 0) {
    return { error: "Venue not found or you don't have permission to edit it." };
  }

  return { error: null };
}
