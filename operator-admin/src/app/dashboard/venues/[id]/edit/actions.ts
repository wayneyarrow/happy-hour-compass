"use server";

import { createClient } from "@/lib/supabase/server";
import { ensureOperatorForSession } from "@/lib/ensureOperator";
import { redirect } from "next/navigation";
import type { VenueFormValues, VenueFormState } from "../../_shared/types";

export type UpdateVenueState = VenueFormState;

/**
 * Server action to update an existing venue's basic fields.
 *
 * `venueId` is bound via `.bind(null, venueId)` in the client component —
 * it is never read from FormData, preventing any client-side ID substitution.
 *
 * Ownership is enforced in two independent layers:
 *   1. The Supabase RLS policy "venues: update own" (database level).
 *   2. The explicit `.eq("created_by_operator_id", operator.id)` filter here
 *      (application level), so no row can be changed even if RLS were
 *      misconfigured.
 *
 * The `slug` column is intentionally NOT updated — it was set on creation
 * and is used as a stable URL/identifier.
 */
export async function updateVenueAction(
  venueId: string,
  _prevState: UpdateVenueState,
  formData: FormData
): Promise<UpdateVenueState> {
  // ── Collect + trim form fields ────────────────────────────────────────────
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
  if (!values.name) {
    return { errors: { name: "Venue name is required." }, values };
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

  // ── Update ────────────────────────────────────────────────────────────────
  // Filter by BOTH id AND created_by_operator_id — if neither matches, the
  // update affects 0 rows, which we treat as an ownership/not-found error.
  // slug is intentionally excluded to keep it stable.
  const { error: updateError, count } = await supabase
    .from("venues")
    .update({
      name:                   values.name,
      address_line1:          values.address_line1  || null,
      city:                   values.city           || null,
      region:                 values.region         || null,
      postal_code:            values.postal_code    || null,
      phone:                  values.phone          || null,
      website_url:            values.website_url    || null,
      // Set updated_by to the current operator on every save.
      updated_by_operator_id: operator.id,
    }, { count: "exact" })
    .eq("id", venueId)
    .eq("created_by_operator_id", operator.id);

  if (updateError) {
    console.error("[updateVenueAction] Update failed:", updateError);
    return {
      errors: { form: `Failed to save changes: ${updateError.message}` },
      values,
    };
  }

  if (count === 0) {
    // 0 rows affected means either the venue doesn't exist or doesn't belong
    // to this operator. Return a safe, generic message.
    return {
      errors: { form: "Venue not found or you don't have permission to edit it." },
      values,
    };
  }

  // Success — redirect to dashboard so the updated venue appears in the list.
  redirect("/dashboard");
}
