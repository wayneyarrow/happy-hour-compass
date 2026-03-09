"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type ChipId = "event" | "venue";

/**
 * Jump-to navigation chips — Event and Venue.
 *
 * ─── Scroll container ────────────────────────────────────────────────────────
 * The consumer layout wraps all page content in a `flex-1 overflow-y-auto` div
 * (consumer/layout.tsx line 26). The outer shell is `overflow-hidden`, so
 * `window` never scrolls. All previous implementations that used
 * `window.addEventListener("scroll")` and `window.scrollTo()` were silently
 * broken — the listener never fired and the scroll calls did nothing.
 *
 * This implementation finds the real scroll container by walking up the DOM
 * from the chips element itself, then attaches the listener and scrolls it.
 *
 * ─── Active-state rule ───────────────────────────────────────────────────────
 * getBoundingClientRect() is always viewport-relative, regardless of which
 * container is scrolling. So the rule is:
 *
 *   triggerLine  = chipsBar.getBoundingClientRect().bottom
 *                  (the actual rendered bottom of the sticky chips bar — no
 *                  hardcoded pixel values)
 *   venueSectionTop = section-venue.getBoundingClientRect().top
 *
 *   if (venueSectionTop <= triggerLine) → active = "venue"
 *   else                               → active = "event"
 *
 * ─── Click scroll ────────────────────────────────────────────────────────────
 * Position the anchor within the scroll container:
 *   scrollTop = anchor.BCR.top - container.BCR.top + container.scrollTop - 10
 * Then call container.scrollTo({ top, behavior: "smooth" }).
 */
export function JumpChips() {
  const [activeId, setActiveId] = useState<ChipId>("event");
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
    const venueSection = document.getElementById("section-venue");
    // containerRef.current is the flex-gap div; its parentElement is the sticky chips bar div.
    const chipsBar = containerRef.current?.parentElement;
    if (!venueSection || !chipsBar) return;

    // Trigger line: the actual rendered bottom of the sticky chips bar.
    // No hardcoded pixel value — measured from the live DOM every call.
    const triggerLine = chipsBar.getBoundingClientRect().bottom;
    const venueSectionTop = venueSection.getBoundingClientRect().top;

    setActiveId(venueSectionTop <= triggerLine ? "venue" : "event");
  }, []);

  useEffect(() => {
    const scrollContainer = containerRef.current
      ? findScrollContainer(containerRef.current)
      : null;
    scrollContainerRef.current = scrollContainer;

    // Listen on the real scroll container, not window.
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

      const anchor = document.getElementById(`anchor-${id}`);
      const container = scrollContainerRef.current;
      if (anchor && container) {
        // Compute anchor's position within the scroll container.
        const top =
          anchor.getBoundingClientRect().top -
          container.getBoundingClientRect().top +
          container.scrollTop -
          10;
        container.scrollTo({ top, behavior: "smooth" });
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
    { id: "event", label: "Event" },
    { id: "venue", label: "Venue" },
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
