/**
 * "Actually seen" rule for website discovery impressions and section
 * exposures (migration 110): the element must be at least
 * VISIBLE_RATIO_THRESHOLD (50%) inside the viewport — after clipping by any
 * scrolling ancestor, e.g. a horizontal rail — for VISIBLE_DURATION_MS (1s)
 * CONTINUOUSLY while the document is visible. Scrolling it below 50%, or
 * hiding the tab, resets the clock; it never accumulates across interruptions.
 * Qualifies at most once per timer instance.
 *
 * Pure state machine with an injected scheduler so the threshold rules are
 * unit-testable without a browser. useVisibleOnce() wires it to an
 * IntersectionObserver and document.visibilityState.
 */

export const VISIBLE_RATIO_THRESHOLD = 0.5;
export const VISIBLE_DURATION_MS = 1000;

export type Scheduler = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type VisibilityTimer = {
  /** Latest IntersectionObserver ratio (0-1) for the element. */
  setIntersectionRatio: (ratio: number) => void;
  /** document.visibilityState === "visible". */
  setDocumentVisible: (visible: boolean) => void;
  dispose: () => void;
  readonly qualified: boolean;
};

export function createVisibilityTimer(params: {
  onQualified: () => void;
  scheduler: Scheduler;
  durationMs?: number;
  ratioThreshold?: number;
  documentVisible?: boolean;
}): VisibilityTimer {
  const durationMs = params.durationMs ?? VISIBLE_DURATION_MS;
  const ratioThreshold = params.ratioThreshold ?? VISIBLE_RATIO_THRESHOLD;
  let intersecting = false;
  let documentVisible = params.documentVisible ?? true;
  let qualified = false;
  let disposed = false;
  let handle: unknown = null;

  function cancel() {
    if (handle !== null) {
      params.scheduler.clearTimeout(handle);
      handle = null;
    }
  }

  function evaluate() {
    if (qualified || disposed) return;
    const eligible = intersecting && documentVisible;
    if (eligible && handle === null) {
      handle = params.scheduler.setTimeout(() => {
        handle = null;
        if (qualified || disposed || !intersecting || !documentVisible) return;
        qualified = true;
        params.onQualified();
      }, durationMs);
    } else if (!eligible) {
      cancel();
    }
  }

  return {
    setIntersectionRatio(ratio) {
      intersecting = ratio >= ratioThreshold;
      evaluate();
    },
    setDocumentVisible(visible) {
      documentVisible = visible;
      evaluate();
    },
    dispose() {
      disposed = true;
      cancel();
    },
    get qualified() {
      return qualified;
    },
  };
}
