"use server";

import { redirect } from "next/navigation";
import { resolveOperatorContext } from "@/lib/impersonation";
import { setActiveVenueCookie } from "@/lib/activeVenueCookie";

/**
 * Sets the operator's active venue for this session and returns to the
 * dashboard. Used by both the venue-selection screen
 * (src/app/admin/select-venue/page.tsx) and the persistent venue switcher
 * (src/app/admin/VenueSwitcher.tsx) — same operation either way: validate
 * ownership, store the selection, land on the dashboard for that venue.
 *
 * Ownership is re-validated server-side against the authenticated operator's
 * actual venue list on every call — a submitted venueId is never trusted on
 * its own, whether it comes from a hidden form field (selection screen) or a
 * <select> value (switcher). This is the only place that may write the
 * active-venue cookie.
 */
export async function selectActiveVenueAction(formData: FormData): Promise<void> {
  const venueId = formData.get("venueId");

  if (typeof venueId !== "string" || !venueId) {
    redirect("/admin/select-venue");
  }

  const ctx = await resolveOperatorContext();
  const isOwnedByOperator = ctx.venues.some((venue) => venue.id === venueId);

  if (!isOwnedByOperator) {
    console.warn(
      "[selectActiveVenueAction] Rejected venue id not owned by the authenticated operator.",
      { operatorId: ctx.operator?.id ?? null, attemptedVenueId: venueId }
    );
    redirect("/admin/select-venue");
  }

  await setActiveVenueCookie(venueId);
  redirect("/admin/home");
}
