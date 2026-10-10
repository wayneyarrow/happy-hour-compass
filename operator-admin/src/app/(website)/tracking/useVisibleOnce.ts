"use client";

import { useEffect, useRef, type RefObject } from "react";
import { createVisibilityTimer } from "@/lib/discoveryTracking/visibilityTimer";

/** Thresholds around the 50% rule so the observer reports crossings in both directions promptly. */
const OBSERVER_THRESHOLDS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Calls onQualified once the element has been ≥50% visible for ≥1
 * continuous second while the tab is visible (see visibilityTimer.ts).
 * IntersectionObserver clips by scrolling ancestors, so a card scrolled out
 * of a horizontal rail is not visible even when the rail itself is.
 * Re-arms only if `resetKey` changes (a different item/placement) — repeat
 * renders of the same element never restart or re-fire it.
 */
export function useVisibleOnce(
  ref: RefObject<Element | null>,
  options: { enabled: boolean; resetKey: string; onQualified: () => void }
): void {
  const onQualifiedRef = useRef(options.onQualified);
  onQualifiedRef.current = options.onQualified;

  const { enabled, resetKey } = options;

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const timer = createVisibilityTimer({
      onQualified: () => {
        observer.disconnect();
        onQualifiedRef.current();
      },
      scheduler: {
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
      documentVisible: document.visibilityState === "visible",
    });

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          timer.setIntersectionRatio(entry.isIntersecting ? entry.intersectionRatio : 0);
        }
      },
      { threshold: OBSERVER_THRESHOLDS }
    );
    observer.observe(el);

    const onVisibilityChange = () => timer.setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      timer.dispose();
    };
  }, [enabled, resetKey, ref]);
}
