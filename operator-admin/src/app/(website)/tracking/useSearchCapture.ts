"use client";

import { useCallback, useEffect, useRef } from "react";
import type { SearchModeValue } from "@/lib/discoveryTracking/discoveryEvents";
import {
  createSearchCaptureController,
  type SearchCaptureController,
  type SearchCaptureResults,
  type SearchCaptureTrigger,
  type SearchOrigin,
} from "@/lib/discoveryTracking/searchCapture";
import { detectMountOrigin } from "@/lib/discoveryTracking/searchOrigin";
import { fireWebsiteSearch, type WebsiteSearchSurface } from "../searchTracking";

/**
 * Wires the pure search-capture rules (src/lib/discoveryTracking/searchCapture.ts)
 * into a website search field.
 *
 * - Call markTyped() from the input's onChange: from then on the query's
 *   origin is "typed".
 * - Until then, a query the page restored or received at mount (?q=) has
 *   the origin detected at mount (url | history | hero_see_all). Listing
 *   pages pass detectInitialOrigin so it is read from the live URL once on
 *   mount; the hero (always typed) does not.
 * - captureNow("enter" | "selection" | "see_all") captures immediately and
 *   returns the search id (null when nothing could be captured yet).
 * - Pass results: null while the results for the current query are unknown.
 * Search behavior itself is untouched — this only observes.
 */
export function useSearchCapture(params: {
  surface: WebsiteSearchSurface;
  mode: SearchModeValue;
  marketId: string;
  query: string;
  results: SearchCaptureResults | null;
  detectInitialOrigin?: boolean;
  enabled?: boolean;
}): {
  markTyped: () => void;
  captureNow: (trigger: Exclude<SearchCaptureTrigger, "pause">) => string | null;
} {
  const { surface, mode, marketId, query, results, detectInitialOrigin = false, enabled = true } = params;

  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const marketIdRef = useRef(marketId);
  marketIdRef.current = marketId;

  const controllerRef = useRef<SearchCaptureController | null>(null);
  const originRef = useRef<SearchOrigin>("typed");
  const originDetectedRef = useRef(!detectInitialOrigin);

  function getController(): SearchCaptureController {
    if (!controllerRef.current) {
      controllerRef.current = createSearchCaptureController({
        emit: (search) => fireWebsiteSearch({ search, surface: surfaceRef.current, marketId: marketIdRef.current }),
        scheduler: {
          setTimeout: (fn, ms) => window.setTimeout(fn, ms),
          clearTimeout: (handle) => window.clearTimeout(handle as number),
        },
        generateId: () => crypto.randomUUID(),
      });
    }
    return controllerRef.current;
  }

  // Origin of a query present at mount, read once from the live address bar
  // (works for listing pages that restore ?q= in an effect after first render).
  useEffect(() => {
    if (originDetectedRef.current) return;
    originDetectedRef.current = true;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && q.trim()) originRef.current = detectMountOrigin(q, mode);
    // Mount-only by design: later mode changes don't change how the initial query arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resultsKey = results ? `${results.count}|${results.capped}|${results.otherFiltersActive}` : "none";

  useEffect(() => {
    if (!enabled) return;
    getController().update({ query, mode, origin: originRef.current, results });
    // `results` is represented by resultsKey (a fresh object each render must not restart the pause timer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, query, mode, resultsKey]);

  useEffect(() => {
    return () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, []);

  const markTyped = useCallback(() => {
    originRef.current = "typed";
  }, []);

  const captureNow = useCallback(
    (trigger: Exclude<SearchCaptureTrigger, "pause">) => (enabled ? getController().captureNow(trigger) : null),
    [enabled]
  );

  return { markTyped, captureNow };
}
