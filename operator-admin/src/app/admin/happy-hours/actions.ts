"use server";

import { revalidatePath } from "next/cache";
import { resolveOperatorContext } from "@/lib/impersonation";
import type { TaglineState, HhTimesState, HhItem, SpecialsState } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared venue-update builder
// ─────────────────────────────────────────────────────────────────────────────

function buildVenueUpdate(
  ctx: Awaited<ReturnType<typeof resolveOperatorContext>>,
  venueId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updates: Record<string, any>
) {
  const q = ctx.supabase
    .from("venues")
    .update(updates, { count: "exact" })
    .eq("id", venueId);
  return ctx.operator ? q.eq("created_by_operator_id", ctx.operator.id) : q;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update tagline (hh_tagline)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateTaglineAction(
  venueId: string,
  _prevState: TaglineState,
  formData: FormData
): Promise<TaglineState> {
  const hh_tagline =
    (formData.get("hh_tagline") as string | null)?.trim() ?? "";

  if (hh_tagline.length > 80) {
    return {
      errors: { hh_tagline: "Please keep the tagline under 80 characters." },
      values: { hh_tagline },
    };
  }

  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return {
      errors: { form: ctx.operatorError ?? "Could not resolve your operator account." },
      values: { hh_tagline },
    };
  }

  const updates = {
    hh_tagline: hh_tagline || null,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  const { error, count } = await buildVenueUpdate(ctx, venueId, updates);

  if (error) {
    console.error("[updateTaglineAction] Update failed:", error);
    return {
      errors: { form: "Failed to save tagline. Please try again." },
      values: { hh_tagline },
    };
  }

  if (count === 0) {
    return {
      errors: { form: "Venue not found or you don't have permission to edit it." },
      values: { hh_tagline },
    };
  }

  revalidatePath("/admin/happy-hours");
  return { success: true, values: { hh_tagline } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update happy hour times (hh_times)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateHhTimesAction(
  venueId: string,
  _prevState: HhTimesState,
  formData: FormData
): Promise<HhTimesState> {
  const hh_times = (formData.get("hh_times") as string | null)?.trim() ?? "";

  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return {
      errors: { form: ctx.operatorError ?? "Could not resolve your operator account." },
    };
  }

  const updates = {
    hh_times: hh_times || null,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  const { error, count } = await buildVenueUpdate(ctx, venueId, updates);

  if (error) {
    console.error("[updateHhTimesAction] Update failed:", error);
    return { errors: { form: "Failed to save times. Please try again." } };
  }

  if (count === 0) {
    return {
      errors: { form: "Venue not found or you don't have permission to edit it." },
    };
  }

  revalidatePath("/admin/happy-hours");
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared validation helper for food / drink specials JSON payloads
// ─────────────────────────────────────────────────────────────────────────────

function validateAndParseItems(raw: string): {
  items: HhItem[];
  error?: string;
} {
  if (!raw.trim()) return { items: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { items: [], error: "Invalid data format. Please try again." };
  }

  if (!Array.isArray(parsed)) {
    return { items: [], error: "Invalid data format. Please try again." };
  }

  const items: HhItem[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as Record<string, unknown>;
    if (typeof item !== "object" || item === null) continue;

    const name = ((item.name as string | undefined) ?? "").trim();
    const price = ((item.price as string | undefined) ?? "").trim();
    const notes = ((item.notes as string | undefined) ?? "").trim();

    if (!name && !price && !notes) continue;

    if (!name) {
      return { items: [], error: `Row ${i + 1}: Item name is required.` };
    }
    if (name.length > 60) {
      return { items: [], error: `Row ${i + 1}: Item name must be 60 characters or fewer.` };
    }
    if (price.length > 10) {
      return { items: [], error: `Row ${i + 1}: Price must be 10 characters or fewer.` };
    }
    if (notes.length > 40) {
      return { items: [], error: `Row ${i + 1}: Notes must be 40 characters or fewer.` };
    }

    items.push({
      name,
      ...(price ? { price } : {}),
      ...(notes ? { notes } : {}),
    });
  }

  return { items: items.slice(0, 3) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update food specials (hh_food_details)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateFoodSpecialsAction(
  venueId: string,
  _prevState: SpecialsState,
  formData: FormData
): Promise<SpecialsState> {
  const raw = (formData.get("hh_food_details") as string | null) ?? "";
  const { items, error: parseError } = validateAndParseItems(raw);

  if (parseError) {
    return { errors: { form: parseError } };
  }

  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return {
      errors: { form: ctx.operatorError ?? "Could not resolve your operator account." },
    };
  }

  const updates = {
    hh_food_details: items.length > 0 ? JSON.stringify(items) : null,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  const { error, count } = await buildVenueUpdate(ctx, venueId, updates);

  if (error) {
    console.error("[updateFoodSpecialsAction] Update failed:", error);
    return { errors: { form: "Failed to save food specials. Please try again." } };
  }

  if (count === 0) {
    return {
      errors: { form: "Venue not found or you don't have permission to edit it." },
    };
  }

  revalidatePath("/admin/happy-hours");
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update drink specials (hh_drink_details)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateDrinkSpecialsAction(
  venueId: string,
  _prevState: SpecialsState,
  formData: FormData
): Promise<SpecialsState> {
  const raw = (formData.get("hh_drink_details") as string | null) ?? "";
  const { items, error: parseError } = validateAndParseItems(raw);

  if (parseError) {
    return { errors: { form: parseError } };
  }

  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return {
      errors: { form: ctx.operatorError ?? "Could not resolve your operator account." },
    };
  }

  const updates = {
    hh_drink_details: items.length > 0 ? JSON.stringify(items) : null,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  const { error, count } = await buildVenueUpdate(ctx, venueId, updates);

  if (error) {
    console.error("[updateDrinkSpecialsAction] Update failed:", error);
    return { errors: { form: "Failed to save drink specials. Please try again." } };
  }

  if (count === 0) {
    return {
      errors: { form: "Venue not found or you don't have permission to edit it." },
    };
  }

  revalidatePath("/admin/happy-hours");
  return { success: true };
}
