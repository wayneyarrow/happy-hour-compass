"use client";

import { exitImpersonationAction } from "./impersonation-actions";

interface Props {
  venueName: string;
  operatorEmail: string | null;
  founderEmail: string;
}

/**
 * Persistent banner shown at the top of every /admin/* page during an active
 * impersonation/support session.
 *
 * Case A (operatorEmail set):
 *   "You are impersonating [Venue] as [operator email]. Exit impersonation."
 *
 * Case B (operatorEmail null — orphan venue):
 *   "You are editing [Venue] as founder/support. No operator is assigned. Exit support mode."
 *
 * The exit button calls exitImpersonationAction (server action), which stamps
 * ended_at on the DB row, clears the cookie, and redirects to /control-panel/venues.
 */
export default function ImpersonationBanner({
  venueName,
  operatorEmail,
  founderEmail,
}: Props) {
  const isOrphanVenue = !operatorEmail;
  const label = isOrphanVenue ? "Exit support mode" : "Exit impersonation";

  return (
    // relative + z-[55]: sits intentionally above the mobile nav drawer's
    // backdrop/panel (z-40/z-50 in AdminMobileNav.tsx). The banner is
    // normal-flow (not fixed) while the drawer is a fixed, viewport-height
    // overlay starting at the physical top of the page — without a
    // positioned stacking context of its own, the banner would be painted
    // *underneath* that fixed overlay and get visually covered while the
    // drawer is open. This keeps the banner (and its Exit button) visible
    // and above the drawer at all times, without moving or resizing anything.
    <div className="relative z-[55] bg-amber-500 text-white px-4 py-2.5 flex items-center justify-between gap-4 text-sm font-medium shrink-0">
      <span className="min-w-0">
        {isOrphanVenue ? (
          <>
            You are editing{" "}
            <span className="font-bold">&ldquo;{venueName}&rdquo;</span> as
            founder/support ({founderEmail}). No operator is assigned.
          </>
        ) : (
          <>
            You are impersonating{" "}
            <span className="font-bold">&ldquo;{venueName}&rdquo;</span> as{" "}
            <span className="font-bold">{operatorEmail}</span> (founder:{" "}
            {founderEmail}).
          </>
        )}
      </span>

      <form action={exitImpersonationAction} className="shrink-0">
        <button
          type="submit"
          className="px-3 py-1 bg-white text-amber-700 rounded-md text-xs font-semibold hover:bg-amber-50 transition-colors whitespace-nowrap"
        >
          {label}
        </button>
      </form>
    </div>
  );
}
