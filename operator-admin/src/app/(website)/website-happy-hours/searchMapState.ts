"use client";

import type { LatLngBounds } from "@/lib/geo";

/**
 * In-memory (module-scope, not sessionStorage/URL) persistence for the Happy
 * Hours search page's map viewport — desktop's always-live split-map bounds
 * and mobile's expanded-map bounds (see desktopMapBounds/mapBounds in
 * HappyHoursSearchClient.tsx).
 *
 * Why this exists: that page is `force-dynamic`, so Next's Router Cache does
 * not retain a dynamic route's component instance — navigating to a venue and
 * returning via browser Back remounts HappyHoursSearchClient from scratch
 * (see the address-bar-reread effect in that file for the same diagnosis
 * applied to filters). Filters survive that remount because they're encoded
 * in the URL; map viewport is deliberately never encoded in the URL (see that
 * file's URL-sync effect), so it needs its own persistence path. A plain
 * module-level object survives the remount because Next's client-side
 * navigation never reloads the document — the JS module stays loaded — while
 * still resetting to a clean slate on an actual new page load/tab.
 *
 * Why gated on popstate: a module-level value would otherwise also leak into
 * a genuinely fresh visit to this page later in the same tab (e.g. the
 * visitor pans the map, browses elsewhere via the site nav, then clicks back
 * into Happy Hours from a normal link) — which must start at the default
 * view, not a stale one. Only an actual browser Back/Forward (a `popstate`
 * event) should restore it. A normal <Link> navigation calls
 * history.pushState and never fires `popstate`, so this stays false for any
 * "intentional fresh search" entry into the page.
 */

type StoredMapState = {
  desktopBounds: LatLngBounds | null;
  mobileBounds: LatLngBounds | null;
};

let lastNavigationWasPopState = false;
const stored: StoredMapState = { desktopBounds: null, mobileBounds: null };
let listenerAttached = false;
// Guards the deferred clear below so a burst of reads only schedules one.
let clearScheduled = false;

function ensurePopStateListener() {
  if (listenerAttached || typeof window === "undefined") return;
  listenerAttached = true;
  window.addEventListener("popstate", () => {
    lastNavigationWasPopState = true;
    // A fresh Back/Forward always deserves its own full clear window, even
    // if one happened to already be pending from an earlier read.
    clearScheduled = false;
  });
}
ensurePopStateListener();

/** Called from desktop's onBoundsChanged on every pan/zoom (write-through — always up to date, regardless of how it will eventually be used). */
export function saveDesktopMapBounds(bounds: LatLngBounds | null) {
  stored.desktopBounds = bounds;
}

/** Called from mobile's onBoundsChanged (only while the map is expanded — see caller) on every pan/zoom. */
export function saveMobileMapBounds(bounds: LatLngBounds | null) {
  stored.mobileBounds = bounds;
}

/**
 * Returns the persisted viewport bounds if — and only if — the most recent
 * navigation was a browser Back/Forward. Returns null for every other kind
 * of navigation (fresh link click, typed URL, reload) by design.
 *
 * The popstate flag is cleared via a zero-delay setTimeout rather than
 * synchronously on read. React 18 Strict Mode (on by default in this app's
 * dev builds — see next.config.ts) mounts every component twice on its
 * initial mount (render → commit effects → clean up → render+commit again),
 * discarding the first pass's component state — so this function runs twice
 * for what is, from the caller's perspective, a single mount. Clearing the
 * flag synchronously on the first (discarded) read meant the second, surviving
 * mount always saw it already consumed and never actually restored anything
 * — confirmed by reproducing the bug against a live dev server. Both Strict
 * Mode passes happen synchronously within the same task, well before a timer
 * fires, so a real subsequent navigation (which always involves at least one
 * new task turn) still clears it in time to prevent a later, unrelated mount
 * from restoring stale state. Production builds don't double-invoke, so this
 * only ever needs a single deferred clear per real Back/Forward.
 */
export function consumeRestoredMapStateIfPopState(): StoredMapState | null {
  if (!lastNavigationWasPopState) return null;
  if (!clearScheduled) {
    clearScheduled = true;
    setTimeout(() => {
      lastNavigationWasPopState = false;
      clearScheduled = false;
    }, 0);
  }
  return { ...stored };
}
