"use server";

import { clearActiveVenueCookie } from "@/lib/activeVenueCookie";

/**
 * Clears the server-owned active-venue cookie as part of sign-out, so a
 * later login never inherits a previously-selected venue — multi-venue
 * operators must always choose again after logging back in (see the file
 * header on src/lib/activeVenueCookie.ts).
 *
 * Does NOT end the Supabase Auth session itself — SignOutButton still calls
 * supabase.auth.signOut() client-side for that. This exists only because the
 * active-venue cookie is httpOnly and therefore cannot be cleared from
 * client JS; it needs its own server round-trip.
 */
export async function clearActiveVenueOnSignOutAction(): Promise<void> {
  await clearActiveVenueCookie();
}
