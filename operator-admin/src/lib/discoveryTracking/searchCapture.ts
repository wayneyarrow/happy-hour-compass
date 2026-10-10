/**
 * Website search capture rules (website_search_events, migration 110).
 *
 * One row per *meaningful* search, not per keystroke:
 *   - pause:     the query stayed unchanged for SEARCH_CAPTURE_PAUSE_MS (1s)
 *                once its results were known.
 *   - enter:     the visitor pressed Enter — captured immediately.
 *   - selection: a hero suggestion was chosen — captured immediately, before
 *                navigation, so the suggestion_select event can reference it.
 *   - see_all:   the hero's "See all … matching" option — same as selection.
 * Overlapping triggers never double-capture: a search is identified by
 * mode + case-insensitive, whitespace-collapsed term, and the same identity
 * is captured at most once until the field is cleared or the term changes.
 * An immediate trigger that arrives before results are known is held and
 * captured the moment they arrive (hero results are fetched asynchronously).
 *
 * Pure, with injected scheduler + id generator, so it can be unit-tested.
 * useSearchCapture() wires it into the React search components.
 */

import type { Scheduler } from "./visibilityTimer";
import type { SearchModeValue } from "./discoveryEvents";

export const SEARCH_CAPTURE_PAUSE_MS = 1000;

export type SearchOrigin = "typed" | "url" | "history" | "hero_see_all";
export type SearchCaptureTrigger = "pause" | "enter" | "selection" | "see_all";

export type SearchCaptureResults = {
  /** Full number of matching results (or the display-capped number when capped). */
  count: number;
  capped: boolean;
  /** Listing pages: whether non-text filters also narrowed `count`. null for the hero. */
  otherFiltersActive: boolean | null;
};

export type SearchCaptureState = {
  query: string;
  mode: SearchModeValue;
  origin: SearchOrigin;
  /** null while results for `query` are not known yet (hero loading). */
  results: SearchCaptureResults | null;
};

export type CapturedSearch = {
  searchId: string;
  searchTerm: string;
  mode: SearchModeValue;
  origin: SearchOrigin;
  trigger: SearchCaptureTrigger;
  resultCount: number;
  resultCountCapped: boolean;
  otherFiltersActive: boolean | null;
};

/** Trim + collapse whitespace — the same normalization /api/track/website-search applies. */
export function normalizeSearchTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function identityOf(mode: SearchModeValue, term: string): string {
  return `${mode}|${term.toLowerCase()}`;
}

export type SearchCaptureController = {
  /** Call whenever query, mode, origin or results change. */
  update: (state: SearchCaptureState) => void;
  /**
   * Immediate capture (Enter / selection / see_all). Returns the search id
   * of the captured (or already-captured identical) search, or null when
   * there is nothing to capture yet (empty query, or results still loading —
   * in which case it is captured as soon as results arrive).
   */
  captureNow: (trigger: Exclude<SearchCaptureTrigger, "pause">) => string | null;
  dispose: () => void;
};

export function createSearchCaptureController(params: {
  emit: (search: CapturedSearch) => void;
  scheduler: Scheduler;
  generateId: () => string;
  pauseMs?: number;
}): SearchCaptureController {
  const pauseMs = params.pauseMs ?? SEARCH_CAPTURE_PAUSE_MS;
  let state: SearchCaptureState | null = null;
  let timer: unknown = null;
  let pendingTrigger: Exclude<SearchCaptureTrigger, "pause"> | null = null;
  let lastIdentity: string | null = null;
  let lastSearchId: string | null = null;
  let disposed = false;

  function cancelTimer() {
    if (timer !== null) {
      params.scheduler.clearTimeout(timer);
      timer = null;
    }
  }

  function capture(trigger: SearchCaptureTrigger): string | null {
    if (!state || !state.results) return null;
    const term = normalizeSearchTerm(state.query);
    if (!term) return null;
    const identity = identityOf(state.mode, term);
    if (identity === lastIdentity) return lastSearchId;
    const searchId = params.generateId();
    lastIdentity = identity;
    lastSearchId = searchId;
    params.emit({
      searchId,
      searchTerm: term,
      mode: state.mode,
      origin: state.origin,
      trigger,
      resultCount: state.results.count,
      resultCountCapped: state.results.capped,
      otherFiltersActive: state.results.otherFiltersActive,
    });
    return searchId;
  }

  return {
    update(next) {
      if (disposed) return;
      const prevTerm = state ? normalizeSearchTerm(state.query) : "";
      const prevMode = state?.mode;
      state = next;
      const term = normalizeSearchTerm(next.query);

      if (!term) {
        // Field cleared: retyping the same term later is a fresh search.
        cancelTimer();
        pendingTrigger = null;
        lastIdentity = null;
        lastSearchId = null;
        return;
      }
      if (term !== prevTerm || next.mode !== prevMode) {
        // A held Enter/selection belonged to the previous query.
        pendingTrigger = null;
      }
      cancelTimer();
      if (!next.results) return;

      if (pendingTrigger) {
        const trigger = pendingTrigger;
        pendingTrigger = null;
        capture(trigger);
        return;
      }
      if (identityOf(next.mode, term) === lastIdentity) return;
      timer = params.scheduler.setTimeout(() => {
        timer = null;
        if (!disposed) capture("pause");
      }, pauseMs);
    },
    captureNow(trigger) {
      if (disposed || !state) return null;
      if (!normalizeSearchTerm(state.query)) return null;
      if (!state.results) {
        pendingTrigger = trigger;
        return null;
      }
      cancelTimer();
      return capture(trigger);
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}
