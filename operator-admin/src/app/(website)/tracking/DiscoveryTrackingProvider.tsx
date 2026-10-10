"use client";

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { getSessionId } from "@/lib/trackingSession";
import type {
  DiscoveryEventPayload,
  DiscoverySectionKind,
  DiscoverySurface,
  GuideBlock,
} from "@/lib/discoveryTracking/discoveryEvents";
import { sendDiscoveryEvent } from "./discoveryClient";

/**
 * Website discovery tracking (migration 110) — page and placement context.
 *
 * <DiscoveryPageTracking> wraps ONE page instance (the live public homepage
 * or a public guide page). It owns:
 *   - page_view_id: generated lazily on the client the first time an event
 *     needs it; a remount (client navigation away and back) is a new page view.
 *   - the once-per-page-view registry for impressions/exposures, so repeat
 *     renders and remounted cards never count twice within one page view.
 *   - the 1-second double-click guard for item clicks.
 * <DiscoveryPlacement> names one placement inside it (a homepage section,
 * the hero, or a guide block). Without a page provider — e.g. the Control
 * Panel's Homepage/Guide previews, which render the same components —
 * every tracking component renders its children only and records nothing.
 */

type PageContext = {
  surfaceDefaults: { marketId: string | null; homepageId: string | null; guideId: string | null };
  getPageViewId: () => string;
  /** Returns true the first time a key is claimed in this page view. */
  claimOnce: (key: string) => boolean;
  /** Returns true unless the same click key fired within the double-click window. */
  allowClick: (key: string) => boolean;
};

export type PlacementContextValue = {
  surface: DiscoverySurface;
  sectionId?: string;
  sectionKind?: DiscoverySectionKind;
  guideBlock?: GuideBlock;
};

const DOUBLE_CLICK_WINDOW_MS = 1000;

const DiscoveryPageContext = createContext<PageContext | null>(null);
const DiscoveryPlacementContext = createContext<PlacementContextValue | null>(null);

export function DiscoveryPageTracking({
  marketId,
  homepageId,
  guideId,
  children,
}: {
  marketId?: string | null;
  homepageId?: string | null;
  guideId?: string | null;
  children: ReactNode;
}) {
  const pageViewIdRef = useRef<string | null>(null);
  const claimedRef = useRef<Set<string>>(new Set());
  const lastClickRef = useRef<Map<string, number>>(new Map());

  const getPageViewId = useCallback(() => {
    if (!pageViewIdRef.current) pageViewIdRef.current = crypto.randomUUID();
    return pageViewIdRef.current;
  }, []);

  const value = useMemo<PageContext>(
    () => ({
      surfaceDefaults: { marketId: marketId ?? null, homepageId: homepageId ?? null, guideId: guideId ?? null },
      getPageViewId,
      claimOnce(key) {
        if (claimedRef.current.has(key)) return false;
        claimedRef.current.add(key);
        return true;
      },
      allowClick(key) {
        const now = Date.now();
        const last = lastClickRef.current.get(key);
        lastClickRef.current.set(key, now);
        return last === undefined || now - last >= DOUBLE_CLICK_WINDOW_MS;
      },
    }),
    [marketId, homepageId, guideId, getPageViewId]
  );

  return <DiscoveryPageContext.Provider value={value}>{children}</DiscoveryPageContext.Provider>;
}

export function DiscoveryPlacement({ children, ...placement }: PlacementContextValue & { children: ReactNode }) {
  const { surface, sectionId, sectionKind, guideBlock } = placement;
  const value = useMemo(() => ({ surface, sectionId, sectionKind, guideBlock }), [surface, sectionId, sectionKind, guideBlock]);
  return <DiscoveryPlacementContext.Provider value={value}>{children}</DiscoveryPlacementContext.Provider>;
}

export type DiscoveryTracker = {
  /** Stable key of the current placement (part of once-per-page-view keys). */
  placementKey: string;
  claimOnce: (key: string) => boolean;
  allowClick: (key: string) => boolean;
  send: (
    event: Pick<DiscoveryEventPayload, "eventType"> &
      Partial<Pick<DiscoveryEventPayload, "itemType" | "itemId" | "position" | "mode" | "searchId" | "targetPath">>,
    options?: { immediate?: boolean }
  ) => void;
};

/**
 * The tracker for the nearest page + placement, or null when tracking is
 * disabled (no page provider) — callers must then record nothing.
 */
export function useDiscoveryTracker(placementOverride?: PlacementContextValue): DiscoveryTracker | null {
  const page = useContext(DiscoveryPageContext);
  const contextPlacement = useContext(DiscoveryPlacementContext);
  const placement = placementOverride ?? contextPlacement;

  return useMemo(() => {
    if (!page || !placement) return null;
    const placementKey =
      placement.surface === "homepage_section"
        ? `s:${placement.sectionId}`
        : placement.surface === "guide"
          ? `g:${placement.guideBlock}`
          : "hero";
    return {
      placementKey,
      claimOnce: page.claimOnce,
      allowClick: page.allowClick,
      send(event, options) {
        const isSection = placement.surface === "homepage_section";
        const isGuide = placement.surface === "guide";
        sendDiscoveryEvent(
          {
            ...event,
            surface: placement.surface,
            pageViewId: page.getPageViewId(),
            sessionId: getSessionId(),
            marketId: page.surfaceDefaults.marketId,
            homepageId: isGuide ? null : page.surfaceDefaults.homepageId,
            sectionId: isSection ? placement.sectionId ?? null : null,
            sectionKind: isSection ? placement.sectionKind ?? null : null,
            guideId: isGuide ? page.surfaceDefaults.guideId : null,
            guideBlock: isGuide ? placement.guideBlock ?? null : null,
          },
          options
        );
      },
    };
  }, [page, placement]);
}
