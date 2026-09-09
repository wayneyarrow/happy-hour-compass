"use client";

import { useEffect } from "react";

/**
 * Guarantees an exact-Special deep link (#daily-special-<uuid>) lands on
 * the right element, on top of (not instead of) the primary mechanism:
 * each Daily Special's container already sets `scrollMarginTop` inline
 * (see DailySpecialsSection.tsx), which is what makes the browser's own
 * native hash-anchor scroll — triggered by a normal cross-page navigation
 * to a URL containing a hash, whether clicked or pasted — land below the
 * sticky header/nav instead of hidden behind it. That native behavior
 * alone should already work for both required cases (a Daily Special
 * results card's link, and a directly pasted venue URL with the hash).
 *
 * This component is a small, deliberately minimal defensive fallback for
 * any Next.js App Router navigation timing quirk where the hash target
 * isn't in the DOM (or isn't laid out) yet at the moment of the initial
 * scroll attempt — it re-checks once after mount and nudges the scroll
 * position if the target exists but isn't already in view. No client
 * state, no highlighting, no polling loop — a single effect that runs
 * once.
 */
export function DailySpecialDeepLinkScroll() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#daily-special-")) return;

    const id = hash.slice(1);
    const el = document.getElementById(id);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const alreadyInView = rect.top >= 0 && rect.top <= window.innerHeight * 0.5;
    if (alreadyInView) return;

    el.scrollIntoView({ behavior: "auto", block: "start" });
  }, []);

  return null;
}
