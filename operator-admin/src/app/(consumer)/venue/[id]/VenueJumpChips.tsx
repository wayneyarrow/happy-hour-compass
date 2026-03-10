"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type ChipId = "happyhour" | "info";

/**
 * Jump-to navigation chips for venue detail — Happy Hour | Info.
 *
 * Directly mirrors JumpChips.tsx from event/[id]/ with the same:
 * - Scroll container discovery (walks DOM to find overflow-y: auto/scroll)
 * - Section-dominance active state (whichever section has more visible pixels)
 * - Click-scroll logic (CSS top + height for sticky offset, not BCR.bottom)
 * - 900 ms click-lock suppression during smooth scroll
 *
 * Only differences from event JumpChips:
 * - ChipId = "happyhour" | "info" (instead of "event" | "venue")
 * - Section IDs: "section-happyhour", "section-info"
 * - "happyhour" chip scrolls to top=0 (it is the first section)
 * - "info" chip scrolls to #section-info h3 heading
 */
export function VenueJumpChips() {
  const [activeId, setActiveId] = useState<ChipId>("happyhour");
  const clickLockRef = useRef(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  /** Walk up the DOM to find the nearest element with overflow-y auto or scroll. */
  function findScrollContainer(el: HTMLElement): HTMLElement | null {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const overflowY = window.getComputedStyle(p).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return p;
      p = p.parentElement;
    }
    return null;
  }

  const syncFromScroll = useCallback(() => {
    if (clickLockRef.current) return;
    const hhSection = document.getElementById("section-happyhour");
    const infoSection = document.getElementById("section-info");
    // containerRef.current is the flex-gap div; its parentElement is the sticky chips bar.
    const chipsBar = containerRef.current?.parentElement;
    const container = scrollContainerRef.current;
    if (!hhSection || !infoSection || !chipsBar || !container) return;

    // Content area: between chips bar bottom and container bottom.
    const contentTop = chipsBar.getBoundingClientRect().bottom;
    const contentBottom = container.getBoundingClientRect().bottom;

    const visiblePx = (el: Element) => {
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(r.bottom, contentBottom) - Math.max(r.top, contentTop));
    };

    // Info wins when it shows more pixels than Happy Hour. Tie → keep Happy Hour (default).
    setActiveId(visiblePx(infoSection) > visiblePx(hhSection) ? "info" : "happyhour");
  }, []);

  useEffect(() => {
    const scrollContainer = containerRef.current
      ? findScrollContainer(containerRef.current)
      : null;
    scrollContainerRef.current = scrollContainer;

    const target: EventTarget = scrollContainer ?? window;
    target.addEventListener("scroll", syncFromScroll, { passive: true });
    syncFromScroll(); // set initial state
    return () => target.removeEventListener("scroll", syncFromScroll);
  }, [syncFromScroll]);

  const scrollToSection = useCallback(
    (id: ChipId) => {
      setActiveId(id);

      // Suppress syncFromScroll during smooth scroll travel.
      clickLockRef.current = true;
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      lockTimerRef.current = setTimeout(() => {
        clickLockRef.current = false;
        syncFromScroll();
      }, 900);

      const container = scrollContainerRef.current;
      if (!container) return;

      if (id === "happyhour") {
        // Happy Hour is the first section — scroll to top.
        container.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        // Info: target the h3 heading, landing flush with the chips bar.
        // Uses CSS top + rendered height (NOT BCR.bottom) for stickyOffset —
        // same reasoning as JumpChips.tsx "venue" case: BCR.bottom is wrong
        // on the first click before the bar has become sticky.
        const heading = document.querySelector("#section-info h3") as HTMLElement | null;
        const chipsBar = containerRef.current?.parentElement;
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (heading && chipsBar) {
          const containerTop = container.getBoundingClientRect().top;
          const headingAbs =
            heading.getBoundingClientRect().top - containerTop + container.scrollTop;
          const stickyOffset =
            parseFloat(window.getComputedStyle(chipsBar).top) +
            chipsBar.getBoundingClientRect().height;
          const top = Math.min(maxScroll, Math.max(0, headingAbs - stickyOffset));
          container.scrollTo({ top, behavior: "smooth" });
        } else {
          container.scrollTo({ top: maxScroll, behavior: "smooth" });
        }
      }
    },
    [syncFromScroll]
  );

  useEffect(() => {
    return () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, []);

  const chips: { id: ChipId; label: string }[] = [
    { id: "happyhour", label: "Happy Hour" },
    { id: "info", label: "Info" },
  ];

  return (
    <div ref={containerRef} className="flex gap-2">
      {chips.map(({ id, label }) => {
        const isActive = activeId === id;
        return (
          <button
            key={id}
            onClick={() => scrollToSection(id)}
            className={`flex-1 text-center border-[1.5px] rounded-[20px] px-5 py-2.5 text-[14px] transition-all ${
              isActive
                ? "bg-blue-500 border-blue-500 text-white font-semibold"
                : "bg-white border-gray-300 text-gray-500 font-medium hover:border-gray-400 hover:bg-gray-50"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
