"use server";

import { redirect } from "next/navigation";
import type { VenueFormValues, VenueFormState } from "../_shared/types";

// Re-export so any existing imports from this file continue to work.
export type { VenueFormValues };
export type CreateVenueState = VenueFormState;

// ── Server action ─────────────────────────────────────────────────────────────

/**
 * Deprecated — venue creation now happens on /admin/venue. The page that
 * rendered this form (/dashboard/venues/new) redirects there; this action
 * redirects too in case it's ever invoked directly, so it can't become an
 * alternate, unapproved venue-creation route.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature fixed by useActionState's action contract
export async function createVenueAction(_prevState: CreateVenueState, _formData: FormData): Promise<CreateVenueState> {
  redirect("/admin/venue");
}
