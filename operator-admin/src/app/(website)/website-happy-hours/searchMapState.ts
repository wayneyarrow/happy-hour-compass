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
 * Why gated on popstate, and on the URL it landed on: a module-level value
 * would otherwise also leak into a genuinely fresh visit to this page later
 * in the same tab (e.g. the visitor pans the map, browses elsewhere via the
 * site nav, then clicks back into Happy Hours from a normal link) — which
 * must start at the default view, not a stale one. Only an actual browser
 * Back/Forward (a `popstate` event) *into this listing* should restore it.
 * A normal <Link> navigation calls history.pushState and never fires
 * `popstate`.
 *
 * The popstate flag alone wasn't enough: it stayed set after a Back anywhere
 * else on the site (e.g. from a guide to a homepage) until the next time this
 * page mounted, so a later ordinary click into Happy Hours restored the old
 * viewport — with two markets, a San Diego map position inside a Kelowna
 * search. So each Back/Forward records the URL it landed on, and a mount
 * restores only when the page's own URL is that URL.
 *
 * Positions are also stored per market and per listing URL (path + query, as
 * kept up to date by the page's filter sync), so Back into a listing restores
 * that listing's own position, never another market's: the legacy
 * /website-happy-hours URL can show either market, depending on the saved
 * market at the time.
 */

type StoredMapState = {
  desktopBounds: LatLngBounds | null;
  mobileBounds: LatLngBounds | null;
};

/** Saved positions, by market and listing URL (see storageKey). */
const stored = new Map<string, StoredMapState>();
/** The URL (path + query) the most recent Back/Forward landed on, until consumed. */
let popStateUrl: string | null = null;
let listenerAttached = false;
// Guards the deferred clear below so a burst of reads only schedules one.
let clearScheduled = false;

function currentUrl(): string {
  return typeof window === "undefined" ? "" : `${window.location.pathname}${window.location.search}`;
}

function storageKey(marketId: string): string {
  return `${marketId}|${currentUrl()}`;
}

function ensurePopStateListener() {
  if (listenerAttached || typeof window === "undefined") return;
  listenerAttached = true;
  window.addEventListener("popstate", () => {
    popStateUrl = currentUrl();
    // A fresh Back/Forward always deserves its own full clear window, even
    // if one happened to already be pending from an earlier read.
    clearScheduled = false;
  });
}
ensurePopStateListener();

function save(marketId: string, patch: Partial<StoredMapState>) {
  const key = storageKey(marketId);
  stored.set(key, { desktopBounds: null, mobileBounds: null, ...stored.get(key), ...patch });
}

/** Called from desktop's onBoundsChanged on every pan/zoom (write-through — always up to date, regardless of how it will eventually be used). */
export function saveDesktopMapBounds(marketId: string, bounds: LatLngBounds | null) {
  save(marketId, { desktopBounds: bounds });
}

/** Called from mobile's onBoundsChanged (only while the map is expanded — see caller) on every pan/zoom. */
export function saveMobileMapBounds(marketId: string, bounds: LatLngBounds | null) {
  save(marketId, { mobileBounds: bounds });
}

/**
 * Returns this market's saved viewport for the current listing URL if — and
 * only if — this page was reached by a browser Back/Forward that landed on
 * this exact URL. Returns null for every other kind of navigation (fresh
 * link click, typed URL, reload, or a Back that happened elsewhere earlier)
 * by design.
 *
 * The popstate marker is cleared via a zero-delay setTimeout rather than
 * synchronously on read. React 18 Strict Mode (on by default in this app's
 * dev builds — see next.config.ts) mounts every component twice on its
 * initial mount (render → commit effects → clean up → render+commit again),
 * discarding the first pass's component state — so this function runs twice
 * for what is, from the caller's perspective, a single mount. Clearing the
 * marker synchronously on the first (discarded) read meant the second,
 * surviving mount always saw it already consumed and never actually restored
 * anything — confirmed by reproducing the bug against a live dev server.
 * Both Strict Mode passes happen synchronously within the same task, well
 * before a timer fires. Production builds don't double-invoke, so this only
 * ever needs a single deferred clear per real Back/Forward.
 */
export function consumeRestoredMapStateIfPopState(marketId: string): StoredMapState | null {
  if (popStateUrl === null) return null;
  const landedHere = popStateUrl === currentUrl();
  if (!clearScheduled) {
    clearScheduled = true;
    setTimeout(() => {
      popStateUrl = null;
      clearScheduled = false;
    }, 0);
  }
  if (!landedHere) return null;
  const entry = stored.get(storageKey(marketId));
  return entry ? { ...entry } : null;
}
