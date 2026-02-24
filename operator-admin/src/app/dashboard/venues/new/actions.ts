"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";
import type { VenueFormValues, VenueFormState } from "../_shared/types";

// Re-export so any existing imports from this file continue to work.
export type { VenueFormValues };
export type CreateVenueState = VenueFormState;

// ── Slug utility ──────────────────────────────────────────────────────────────

/**
 * Converts a venue name into a URL-safe slug with a short random suffix
 * to make collisions against the UNIQUE constraint virtually impossible.
 *
 * e.g. "The Rusty Anchor!" → "the-rusty-anchor-x7k2m"
 */
function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric → dash
    .replace(/^-+|-+$/g, "")     // strip leading/trailing dashes
    .slice(0, 50);                // keep it readable

  const suffix = Math.random().toString(36).slice(2, 7);
  return base ? `${base}-${suffix}` : `venue-${suffix}`;
}

// ── Server action ─────────────────────────────────────────────────────────────

/**
 * Server action called by the Create Venue form via useActionState.
 *
 * On success  → redirects to /dashboard (Next.js handles this transparently).
 * On failure  → returns a CreateVenueState with errors and preserved values.
 *
 * Security:
 *   - Re-resolves the operator server-side on every submit; never trusts
 *     a client-provided operator ID.
 *   - Sets `created_by_operator_id` from the resolved operator row, not from
 *     the auth user ID.
 */
export async function createVenueAction(
  _prevState: CreateVenueState,
  formData: FormData
): Promise<CreateVenueState> {
  // Collect and trim form fields
  const values: VenueFormValues = {
    name:         (formData.get("name")         as string | null)?.trim() ?? "",
    address_line1:(formData.get("address_line1") as string | null)?.trim() ?? "",
    city:         (formData.get("city")          as string | null)?.trim() ?? "",
    region:       (formData.get("region")        as string | null)?.trim() ?? "",
    postal_code:  (formData.get("postal_code")   as string | null)?.trim() ?? "",
    phone:        (formData.get("phone")         as string | null)?.trim() ?? "",
    website_url:  (formData.get("website_url")   as string | null)?.trim() ?? "",
  };

  // ── Validate ──────────────────────────────────────────────────────────────
  const errors: CreateVenueState["errors"] = {};

  if (!values.name) {
    errors.name = "Venue name is required.";
  }

  if (Object.keys(errors).length > 0) {
    return { errors, values };
  }

  // ── Auth + operator resolution ────────────────────────────────────────────
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      errors: { form: "Your session has expired. Please sign in again." },
      values,
    };
  }

  const { operator, error: operatorError } = await ensureOperatorForSession(
    supabase,
    user
  );

  if (operatorError || !operator) {
    return {
      errors: {
        form: operatorError ?? "Could not resolve your operator account. Try refreshing the page.",
      },
      values,
    };
  }

  // ── Insert ────────────────────────────────────────────────────────────────
  const { error: insertError } = await supabase.from("venues").insert({
    name:                    values.name,
    slug:                    generateSlug(values.name),
    address_line1:           values.address_line1  || null,
    city:                    values.city           || null,
    region:                  values.region         || null,
    postal_code:             values.postal_code    || null,
    phone:                   values.phone          || null,
    website_url:             values.website_url    || null,
    // Ownership — always derived server-side from the resolved operator row.
    created_by_operator_id:  operator.id,
    updated_by_operator_id:  operator.id,
  });

  if (insertError) {
    console.error("[createVenueAction] Insert failed:", insertError);
    return {
      errors: {
        form: `Failed to create venue: ${insertError.message}`,
      },
      values,
    };
  }

  // Success — redirect to dashboard so the new venue appears in the list.
  redirect("/dashboard");
}
