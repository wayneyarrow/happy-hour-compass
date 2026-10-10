/**
 * Where did a listing page's initial search query come from? (website_search_events.origin)
 *
 *   history       — the browser's Back/Forward restored the page: either a
 *                   popstate within HISTORY_WINDOW_MS before mount (Next.js
 *                   client navigation remounts from its router cache), or the
 *                   document itself was loaded by back_forward and this mount
 *                   is still at that document's original URL.
 *   hero_see_all  — the homepage hero's "See all … matching" handed this exact
 *                   query/mode over moments ago (sessionStorage handoff,
 *                   consumed on read). The hero already logged its own row.
 *   url           — anything else that opened the page with ?q= (an external,
 *                   pasted or bookmarked link).
 * Queries the visitor types afterwards are "typed" (decided by the caller).
 *
 * Pure decision function + a small browser adapter at the bottom.
 */

import type { SearchModeValue } from "./discoveryEvents";
import type { SearchOrigin } from "./searchCapture";
import { normalizeSearchTerm } from "./searchCapture";

export const HISTORY_WINDOW_MS = 3000;
export const HANDOFF_MAX_AGE_MS = 15000;
export const SEARCH_HANDOFF_STORAGE_KEY = "hhc_search_handoff";

export type SearchHandoff = { term: string; mode: SearchModeValue; at: number };

export function resolveMountOrigin(input: {
  now: number;
  query: string;
  mode: SearchModeValue;
  lastPopstateAt: number | null;
  /** PerformanceNavigationTiming.type of the current document. */
  navigationType: string | null;
  /** True when location.href still equals the document's initially loaded URL. */
  atInitialDocumentUrl: boolean;
  handoff: SearchHandoff | null;
}): Exclude<SearchOrigin, "typed"> {
  if (input.lastPopstateAt !== null && input.now - input.lastPopstateAt >= 0 && input.now - input.lastPopstateAt <= HISTORY_WINDOW_MS) {
    return "history";
  }
  if (input.navigationType === "back_forward" && input.atInitialDocumentUrl) {
    return "history";
  }
  const h = input.handoff;
  if (
    h &&
    h.mode === input.mode &&
    input.now - h.at >= 0 &&
    input.now - h.at <= HANDOFF_MAX_AGE_MS &&
    normalizeSearchTerm(h.term).toLowerCase() === normalizeSearchTerm(input.query).toLowerCase()
  ) {
    return "hero_see_all";
  }
  return "url";
}

// ── Browser adapter ─────────────────────────────────────────────────────────

let lastPopstateAt: number | null = null;
let popstateListenerInstalled = false;

/** Installs the (single) popstate recorder. Idempotent; call from a client effect or module load. */
export function installPopstateRecorder(): void {
  if (popstateListenerInstalled || typeof window === "undefined") return;
  popstateListenerInstalled = true;
  window.addEventListener("popstate", () => {
    lastPopstateAt = Date.now();
  });
}

if (typeof window !== "undefined") installPopstateRecorder();

/** Hero → listing handoff, written just before the hero navigates to "See all". */
export function writeSearchHandoff(term: string, mode: SearchModeValue): void {
  try {
    const handoff: SearchHandoff = { term, mode, at: Date.now() };
    sessionStorage.setItem(SEARCH_HANDOFF_STORAGE_KEY, JSON.stringify(handoff));
  } catch {
    // sessionStorage unavailable — the listing page will fall back to "url".
  }
}

function consumeSearchHandoff(): SearchHandoff | null {
  try {
    const raw = sessionStorage.getItem(SEARCH_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SEARCH_HANDOFF_STORAGE_KEY);
    const parsed = JSON.parse(raw) as Partial<SearchHandoff>;
    if (typeof parsed.term !== "string" || typeof parsed.mode !== "string" || typeof parsed.at !== "number") return null;
    return parsed as SearchHandoff;
  } catch {
    return null;
  }
}

/** Browser-side origin of a listing page's query at mount. Consumes any handoff. */
export function detectMountOrigin(query: string, mode: SearchModeValue): Exclude<SearchOrigin, "typed"> {
  let navigationType: string | null = null;
  let atInitialDocumentUrl = false;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      navigationType = nav.type;
      atInitialDocumentUrl = nav.name === window.location.href;
    }
  } catch {
    // Navigation Timing unavailable — popstate/handoff still apply.
  }
  return resolveMountOrigin({
    now: Date.now(),
    query,
    mode,
    lastPopstateAt,
    navigationType,
    atInitialDocumentUrl,
    handoff: consumeSearchHandoff(),
  });
}
