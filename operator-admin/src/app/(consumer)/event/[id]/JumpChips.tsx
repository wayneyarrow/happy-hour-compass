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
 * Uses a section-dominance check rather than a fixed trigger line.
 *
 * The page is not tall enough for section-venue's top edge to ever reach
 * chipsBar.BCR.bottom in the scroll container — the computed scroll target
 * always exceeds maxScrollTop, so the browser clamps and the position-based
 * trigger is never satisfied.
 *
 * Instead: whichever section occupies more visible pixels in the content area
 * (below chips bar, above container bottom) is the active section.
 *
 *   contentTop    = chipsBar.BCR.bottom
 *   contentBottom = container.BCR.bottom
 *   visiblePx(el) = max(0, min(el.BCR.bottom, contentBottom) − max(el.BCR.top, contentTop))
 *   active = visiblePx(venue) > visiblePx(event) ? "venue" : "event"
 *
 * At scrollTop=0:  event fills most of the visible area, venue is off-screen → event.
 * At maxScrollTop: venue occupies ~340px, event ~267px → venue.
 *
 * ─── Click scroll ────────────────────────────────────────────────────────────
 * Event: scroll to top=0 (event content is at the top of the page).
 * Venue: scroll to maxScrollTop (venue is at the end; any computed target
 *        targeting h3 at chipsBar.bottom exceeds maxScrollTop anyway).
 *
 * Both cases land in unambiguous dominance territory for their section,
 * so the post-scroll sync always confirms the clicked chip.
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
    const eventSection = document.getElementById("section-event");
    const venueSection = document.getElementById("section-venue");
    // containerRef.current is the flex-gap div; its parentElement is the sticky chips bar div.
    const chipsBar = containerRef.current?.parentElement;
    const container = scrollContainerRef.current;
    if (!eventSection || !venueSection || !chipsBar || !container) return;

    // Content area: between chips bar bottom and container bottom.
    const contentTop = chipsBar.getBoundingClientRect().bottom;
    const contentBottom = container.getBoundingClientRect().bottom;

    // Pixel height of each section currently visible within the content area.
    const visiblePx = (el: Element) => {
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(r.bottom, contentBottom) - Math.max(r.top, contentTop));
    };

    // Venue wins when it shows more pixels than Event. Tie → keep Event (default).
    setActiveId(visiblePx(venueSection) > visiblePx(eventSection) ? "venue" : "event");
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

      // Click targets use explicit positions rather than h3-targeting math.
      //
      // The computed h3 target for Venue (h3.abs − stickyOffset) always exceeds
      // maxScrollTop because the page is not tall enough to bring venue's heading
      // to the chips bar line. The browser clamps the target, the section lands
      // further down than the (now-fixed) dominance trigger expects, causing the
      // chip to flip back.
      //
      // Explicit targets are unambiguous and always land in dominant territory:
      //   Event → top=0         event section is at the top of the page; fully dominant.
      //   Venue → maxScrollTop  venue section is at the end; dominant at max scroll.
      const container = scrollContainerRef.current;
      if (!container) return;

      if (id === "event") {
        container.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        container.scrollTo({
          top: container.scrollHeight - container.clientHeight,
          behavior: "smooth",
        });
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
