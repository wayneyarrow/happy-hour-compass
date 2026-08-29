import { cookies } from "next/headers";

/**
 * Server-owned "active venue" selection for a multi-venue Operator Admin
 * session (Phase 1 multi-venue support, 2026-08-29).
 *
 * This cookie is a convenience pointer only — it is NEVER trusted on its
 * own. Every read site (see resolveOperatorContext in src/lib/impersonation.ts)
 * validates the value against the authenticated operator's actual owned-venue
 * list before treating it as the active venue. A tampered/forged/stale value
 * that doesn't match an owned venue is simply treated as "no selection" —
 * see resolveVenuesAndActiveVenue() in impersonation.ts.
 *
 * httpOnly: not readable/writable from client JS — only server code
 * (server actions, route handlers) can set or clear it.
 *
 * No maxAge/expires is set: this makes it a browser session cookie so it
 * doesn't outlive the browser session by itself, but that alone is NOT
 * sufficient to satisfy "does not persist across logout/login" (a user can
 * log out and back in within the same browser session without closing the
 * browser). The active-venue cookie MUST also be explicitly cleared as part
 * of sign-out — see SignOutButton / the sign-out route — so a fresh login
 * always starts with no active venue selected.
 */
export const ACTIVE_VENUE_COOKIE = "active_venue_id";

/** Reads the raw cookie value with no ownership validation — callers must validate. */
export async function getActiveVenueIdFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_VENUE_COOKIE)?.value ?? null;
}

/**
 * Sets the active-venue cookie. Callers MUST have already validated that the
 * venue belongs to the authenticated operator — this function performs no
 * ownership check itself (it has no access to that context).
 */
export async function setActiveVenueCookie(venueId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_VENUE_COOKIE, venueId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Intentionally no maxAge/expires — see file header. Also explicitly
    // cleared on sign-out so it never survives a logout/login cycle.
  });
}

/** Clears the active-venue cookie. Called on sign-out and on venue-selection errors. */
export async function clearActiveVenueCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_VENUE_COOKIE);
}
