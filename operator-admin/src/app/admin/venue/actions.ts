"use server";

import { resolveOperatorContext } from "@/lib/impersonation";
import { redirect } from "next/navigation";
import {
  ESTABLISHMENT_TYPE_OPTIONS,
  PAYMENT_OPTIONS,
  type BusinessDetailsState,
  type CreateVenueAdminState,
  type LinksState,
  type PaymentTypesState,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Slug utility
// ─────────────────────────────────────────────────────────────────────────────

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  const suffix = Math.random().toString(36).slice(2, 7);
  return base ? `${base}-${suffix}` : `venue-${suffix}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the venue UPDATE query with correct ownership scoping.
 *
 * Normal / Case A impersonation: filter by both venue id AND operator id.
 * Case B impersonation (orphan):  filter by venue id only (no operator assigned).
 *
 * In impersonation mode ctx.supabase is the admin client (bypasses RLS).
 * The explicit filter ensures we never touch any venue other than the target.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // Add operator ownership filter when operator is known.
  // In Case B (orphan) there is no operator, so venue id alone is the scope.
  return ctx.operator
    ? q.eq("created_by_operator_id", ctx.operator.id)
    : q;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create venue (admin context — redirects to /admin/venue on success)
// ─────────────────────────────────────────────────────────────────────────────

export async function createVenueAdminAction(
  _prevState: CreateVenueAdminState,
  formData: FormData
): Promise<CreateVenueAdminState> {
  const name = (formData.get("name") as string | null)?.trim() ?? "";

  if (!name) {
    return { errors: { name: "Venue name is required." }, values: { name } };
  }

  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return {
      errors: { form: ctx.operatorError ?? "Could not resolve your operator account." },
      values: { name },
    };
  }

  // Creating a new venue requires an operator; not available in Case B orphan mode.
  if (!ctx.operator) {
    return {
      errors: { form: "Creating a new venue is not available in support mode for unassigned venues." },
      values: { name },
    };
  }

  const { error: insertError } = await ctx.supabase.from("venues").insert({
    name,
    slug: generateSlug(name),
    created_by_operator_id: ctx.operator.id,
    updated_by_operator_id: ctx.operator.id,
  });

  if (insertError) {
    console.error("[createVenueAdminAction] Insert failed:", insertError);
    return {
      errors: { form: `Failed to create venue: ${insertError.message}` },
      values: { name },
    };
  }

  redirect("/admin/venue");
}

// ─────────────────────────────────────────────────────────────────────────────
// Update business details
// ─────────────────────────────────────────────────────────────────────────────

export async function updateBusinessDetailsAction(
  venueId: string,
  _prevState: BusinessDetailsState,
  formData: FormData
): Promise<BusinessDetailsState> {
  const rawEstType = (formData.get("establishment_type") as string | null)?.trim() ?? "";
  const values = {
    name:               (formData.get("name")          as string | null)?.trim() ?? "",
    address_line1:      (formData.get("address_line1") as string | null)?.trim() ?? "",
    city:               (formData.get("city")          as string | null)?.trim() ?? "",
    region:             (formData.get("region")        as string | null)?.trim() ?? "",
    postal_code:        (formData.get("postal_code")   as string | null)?.trim() ?? "",
    phone:              (formData.get("phone")         as string | null)?.trim() ?? "",
    country:            (formData.get("country")       as string | null)?.trim() ?? "",
    lat:                (formData.get("lat")           as string | null)?.trim() ?? "",
    lng:                (formData.get("lng")           as string | null)?.trim() ?? "",
    establishment_type: (ESTABLISHMENT_TYPE_OPTIONS as readonly string[]).includes(rawEstType)
      ? rawEstType
      : "Restaurant and Bar",
  };

  if (!values.name) {
    return { errors: { name: "Venue name is required." }, values };
  }

  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return {
      errors: { form: ctx.operatorError ?? "Could not resolve your operator account." },
      values,
    };
  }

  const latNum = values.lat ? parseFloat(values.lat) : null;
  const lngNum = values.lng ? parseFloat(values.lng) : null;

  const updates = {
    name:                   values.name,
    address_line1:          values.address_line1 || null,
    city:                   values.city          || null,
    region:                 values.region        || null,
    postal_code:            values.postal_code   || null,
    phone:                  values.phone         || null,
    country:                values.country       || null,
    lat:                    latNum != null && !Number.isNaN(latNum) ? latNum : null,
    lng:                    lngNum != null && !Number.isNaN(lngNum) ? lngNum : null,
    establishment_type:     values.establishment_type,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  const { error: updateError, count } = await buildVenueUpdate(ctx, venueId, updates);

  if (updateError) {
    console.error("[updateBusinessDetailsAction] Update failed:", updateError);
    return { errors: { form: `Failed to save: ${updateError.message}` }, values };
  }

  if (count === 0) {
    return {
      errors: { form: "Venue not found or you don't have permission to edit it." },
      values,
    };
  }

  return { success: true, values };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update payment types
// ─────────────────────────────────────────────────────────────────────────────

export async function updatePaymentTypesAction(
  venueId: string,
  _prevState: PaymentTypesState,
  formData: FormData
): Promise<PaymentTypesState> {
  const selected = PAYMENT_OPTIONS.filter(
    (t) => formData.get(`payment_${t}`) === "on"
  );

  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return {
      errors: { form: ctx.operatorError ?? "Could not resolve your operator account." },
    };
  }

  const updates = {
    payment_types: selected,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  const { error: updateError, count } = await buildVenueUpdate(ctx, venueId, updates);

  if (updateError) {
    console.error("[updatePaymentTypesAction] Update failed:", updateError);
    return { errors: { form: `Failed to save: ${updateError.message}` } };
  }

  if (count === 0) {
    return {
      errors: { form: "Venue not found or you don't have permission to edit it." },
    };
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update links
// ─────────────────────────────────────────────────────────────────────────────

export async function updateLinksAction(
  venueId: string,
  _prevState: LinksState,
  formData: FormData
): Promise<LinksState> {
  const values = {
    website_url: (formData.get("website_url") as string | null)?.trim() ?? "",
    menu_url:    (formData.get("menu_url")    as string | null)?.trim() ?? "",
  };

  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return {
      errors: { form: ctx.operatorError ?? "Could not resolve your operator account." },
      values,
    };
  }

  const updates = {
    website_url:            values.website_url || null,
    menu_url:               values.menu_url    || null,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  const { error: updateError, count } = await buildVenueUpdate(ctx, venueId, updates);

  if (updateError) {
    console.error("[updateLinksAction] Update failed:", updateError);
    return { errors: { form: `Failed to save: ${updateError.message}` }, values };
  }

  if (count === 0) {
    return {
      errors: { form: "Venue not found or you don't have permission to edit it." },
      values,
    };
  }

  return { success: true, values };
}
