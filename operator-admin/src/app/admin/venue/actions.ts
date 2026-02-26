"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";
import {
  PAYMENT_OPTIONS,
  type BusinessDetailsState,
  type CreateVenueAdminState,
  type LinksState,
  type PaymentTypesState,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Slug utility (same logic as createVenueAction)
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
// Auth helper
// ─────────────────────────────────────────────────────────────────────────────

async function resolveOperator() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, operator: null, operatorError: "Session expired. Please sign in again." };
  const { operator, error: operatorError } = await ensureOperatorForSession(supabase, user);
  return { supabase, user, operator, operatorError };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create venue (admin context — redirects to /admin/venue on success)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new venue with just a name.
 * Additional details are filled in via the edit sections after creation.
 *
 * Ownership is set server-side from the resolved operator row.
 * No client-supplied operator ID is accepted.
 */
export async function createVenueAdminAction(
  _prevState: CreateVenueAdminState,
  formData: FormData
): Promise<CreateVenueAdminState> {
  const name = (formData.get("name") as string | null)?.trim() ?? "";

  if (!name) {
    return { errors: { name: "Venue name is required." }, values: { name } };
  }

  const { supabase, operator, operatorError } = await resolveOperator();

  if (operatorError || !operator) {
    return {
      errors: { form: operatorError ?? "Could not resolve your operator account." },
      values: { name },
    };
  }

  const { error: insertError } = await supabase.from("venues").insert({
    name,
    slug: generateSlug(name),
    created_by_operator_id: operator.id,
    updated_by_operator_id: operator.id,
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

/**
 * Updates the venue's core business fields.
 *
 * `venueId` is bound via `.bind(null, venueId)` — never read from FormData.
 * Ownership enforced at two layers:
 *   1. RLS policy "venues: update own" (database).
 *   2. Explicit `.eq("created_by_operator_id", operator.id)` (application).
 */
export async function updateBusinessDetailsAction(
  venueId: string,
  _prevState: BusinessDetailsState,
  formData: FormData
): Promise<BusinessDetailsState> {
  const values = {
    name:          (formData.get("name")          as string | null)?.trim() ?? "",
    address_line1: (formData.get("address_line1") as string | null)?.trim() ?? "",
    city:          (formData.get("city")          as string | null)?.trim() ?? "",
    region:        (formData.get("region")        as string | null)?.trim() ?? "",
    postal_code:   (formData.get("postal_code")   as string | null)?.trim() ?? "",
    phone:         (formData.get("phone")         as string | null)?.trim() ?? "",
    country:       (formData.get("country")       as string | null)?.trim() ?? "",
    latitude:      (formData.get("latitude")      as string | null)?.trim() ?? "",
    longitude:     (formData.get("longitude")     as string | null)?.trim() ?? "",
  };

  if (!values.name) {
    return { errors: { name: "Venue name is required." }, values };
  }

  const { supabase, operator, operatorError } = await resolveOperator();

  if (operatorError || !operator) {
    return {
      errors: { form: operatorError ?? "Could not resolve your operator account." },
      values,
    };
  }

  const lat = values.latitude ? parseFloat(values.latitude) : null;
  const lng = values.longitude ? parseFloat(values.longitude) : null;

  const { error: updateError, count } = await supabase
    .from("venues")
    .update(
      {
        name:                   values.name,
        address_line1:          values.address_line1 || null,
        city:                   values.city          || null,
        region:                 values.region        || null,
        postal_code:            values.postal_code   || null,
        phone:                  values.phone         || null,
        country:                values.country       || null,
        latitude:               lat != null && !Number.isNaN(lat) ? lat : null,
        longitude:              lng != null && !Number.isNaN(lng) ? lng : null,
        updated_by_operator_id: operator.id,
      },
      { count: "exact" }
    )
    .eq("id", venueId)
    .eq("created_by_operator_id", operator.id);

  if (updateError) {
    console.error("[updateBusinessDetailsAction] Update failed:", updateError);
    return {
      errors: { form: `Failed to save: ${updateError.message}` },
      values,
    };
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

/**
 * Saves the selected payment methods for the venue.
 * Stored as a string array in the `payment_types` JSONB column.
 *
 * `venueId` is bound — never read from FormData.
 * Dual ownership filter enforced.
 */
export async function updatePaymentTypesAction(
  venueId: string,
  _prevState: PaymentTypesState,
  formData: FormData
): Promise<PaymentTypesState> {
  const selected = PAYMENT_OPTIONS.filter(
    (t) => formData.get(`payment_${t}`) === "on"
  );

  const { supabase, operator, operatorError } = await resolveOperator();

  if (operatorError || !operator) {
    return {
      errors: { form: operatorError ?? "Could not resolve your operator account." },
    };
  }

  const { error: updateError, count } = await supabase
    .from("venues")
    .update(
      { payment_types: selected, updated_by_operator_id: operator.id },
      { count: "exact" }
    )
    .eq("id", venueId)
    .eq("created_by_operator_id", operator.id);

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

/**
 * Saves website and menu URLs for the venue.
 *
 * `venueId` is bound — never read from FormData.
 * Dual ownership filter enforced.
 */
export async function updateLinksAction(
  venueId: string,
  _prevState: LinksState,
  formData: FormData
): Promise<LinksState> {
  const values = {
    website_url: (formData.get("website_url") as string | null)?.trim() ?? "",
    menu_url:    (formData.get("menu_url")    as string | null)?.trim() ?? "",
  };

  const { supabase, operator, operatorError } = await resolveOperator();

  if (operatorError || !operator) {
    return {
      errors: { form: operatorError ?? "Could not resolve your operator account." },
      values,
    };
  }

  const { error: updateError, count } = await supabase
    .from("venues")
    .update(
      {
        website_url:            values.website_url || null,
        menu_url:               values.menu_url    || null,
        updated_by_operator_id: operator.id,
      },
      { count: "exact" }
    )
    .eq("id", venueId)
    .eq("created_by_operator_id", operator.id);

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
