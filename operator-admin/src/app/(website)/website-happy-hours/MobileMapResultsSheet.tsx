"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
// Peek: header row only (drag handle + result count) — the sheet's resting
// state whenever the mobile map is expanded (matches the expected "expanded
// map state" behaviour: map stays large, a results header is anchored at the
// bottom). Open: reveals the venue list, leaving a small sliver of map
// visible at the top so the map is never fully hidden behind the list.
// Sized with headroom beyond the header row's own content height so a visible
// sliver of the list peeks through underneath — that sliver, plus the larger
// touch target, is what signals "this pulls up" at rest.
export const PEEK_HEIGHT_PX = 124;
const OPEN_TOP_GAP_PX = 72;
// Pointer travel (px) before a press counts as a drag rather than a tap —
// lets the header double as both the drag handle and a plain tap-to-toggle
// control (the accessible, non-drag fallback).
const DRAG_THRESHOLD_PX = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type Props = {
  /** Current rendered height (px) of the map+sheet container this sheet overlays — used to size the "open" height, leaving OPEN_TOP_GAP_PX of map visible. */
  containerHeightPx: number;
  /** Single-line label next to the drag handle — result count or empty-state text. */
  headerLabel: string;
  /** Venue list / empty-state content, shown in the scrollable body below the header. */
  children: ReactNode;
};

/**
 * Draggable bottom sheet overlaid on the expanded mobile map. Two snap points
 * only (peek/open) — deliberately not a multi-snap-point or velocity-aware
 * bottom sheet framework, since a binary peek/open toggle fully covers the
 * required interaction (reveal the list vs. see more map) with the smallest
 * possible implementation and no new dependency.
 *
 * Gesture ownership: the header (handle + label) is the ONLY drag target —
 * pointer events are captured there via setPointerCapture, and it has
 * touch-action:none so the browser never hijacks it as a page scroll. The
 * body below it is a plain overflow-y:auto region with no pointer handlers
 * of its own, so list scrolling is native and never fights the sheet's
 * drag. The map lives in a separate DOM subtree behind this sheet and is
 * never touched by these handlers, so its own pan/zoom gestures are
 * unaffected.
 */
export function MobileMapResultsSheet({ containerHeightPx, headerLabel, children }: Props) {
  const openHeightPx =
    containerHeightPx > 0
      ? Math.max(PEEK_HEIGHT_PX + 80, containerHeightPx - OPEN_TOP_GAP_PX)
      : PEEK_HEIGHT_PX + 300;

  const [sheetState, setSheetState] = useState<"peek" | "open">("peek");
  const [dragHeightPx, setDragHeightPx] = useState<number | null>(null);
  const dragRef = useRef<{ startY: number; baseHeight: number; dragged: boolean } | null>(null);

  const baseHeight = sheetState === "open" ? openHeightPx : PEEK_HEIGHT_PX;
  const height = dragHeightPx ?? baseHeight;
  const isDragging = dragHeightPx !== null;

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, baseHeight: height, dragged: false };
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = e.clientY - drag.startY; // positive = finger moved down
    if (Math.abs(delta) > DRAG_THRESHOLD_PX) drag.dragged = true;
    setDragHeightPx(clamp(drag.baseHeight - delta, PEEK_HEIGHT_PX, openHeightPx));
  }

  function handlePointerUp() {
    const drag = dragRef.current;
    if (!drag) return;
    const finalHeight = dragHeightPx ?? drag.baseHeight;
    const midpoint = (PEEK_HEIGHT_PX + openHeightPx) / 2;
    setSheetState(finalHeight >= midpoint ? "open" : "peek");
    setDragHeightPx(null);
    // Not cleared here — handleHeaderClick (which fires right after, for the
    // same interaction) still needs to read drag.dragged to decide whether
    // to also toggle state for a plain tap.
  }

  function handleHeaderClick() {
    // A real drag still synthesizes a click on release — swallow that one so
    // dragging never also toggles the state a second time via this handler.
    if (dragRef.current?.dragged) {
      dragRef.current = null;
      return;
    }
    dragRef.current = null;
    setSheetState((s) => (s === "open" ? "peek" : "open"));
  }

  function handleHeaderKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSheetState((s) => (s === "open" ? "peek" : "open"));
    }
  }

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl bg-white shadow-[0_-6px_20px_rgba(0,0,0,0.14)]"
      style={{ height, transition: isDragging ? "none" : "height 220ms ease-out" }}
    >
      {/* Drag handle + label — the sole drag target, and the accessible
          non-drag fallback (tap, or Enter/Space, toggles peek/open). */}
      <div
        className="flex flex-shrink-0 touch-none select-none flex-col items-center gap-2 px-4 pt-3.5 pb-4 cursor-grab active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={sheetState === "open"}
        aria-label={
          sheetState === "open"
            ? `Collapse results, ${headerLabel}`
            : `Expand results, ${headerLabel}`
        }
      >
        <span aria-hidden="true" className="h-1.5 w-12 rounded-full bg-gray-300" />
        <p className="text-sm font-semibold text-gray-800">{headerLabel}</p>
      </div>

      {/* Scrollable body — native scroll only, no drag handlers of its own. */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">{children}</div>
    </div>
  );
}
