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
 *
 * Venue: target = headingAbs − stickyOffset, clamped to maxScrollTop.
 *   headingAbs   = h3.BCR.top − container.BCR.top + container.scrollTop
 *   stickyOffset = getComputedStyle(chipsBar).top + chipsBar.BCR.height
 *                  (CSS top value + rendered height — NOT chipsBar.BCR.bottom)
 *
 *   chipsBar.BCR.bottom must NOT be used here: on the first click the chips bar
 *   is not yet sticky (natural flow position ~555px), making BCR.bottom ~414px
 *   larger than the correct sticky value (~141px) and causing the target to
 *   under-scroll. The CSS top approach gives the correct sticky bottom regardless
 *   of current scroll position.
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

      // Event: scroll to top=0 (event content is near the top of the page).
      //
      // Venue: target the Venue <h3> heading to land flush with the chips bar.
      //   target = headingAbs − stickyOffset
      //   clamped to maxScrollTop as a ceiling (handles short pages).
      //
      // Previously this was always maxScrollTop, which overshot on longer event
      // descriptions (maxScrollTop > h3Target), hiding the heading above the chips
      // bar. Using the h3 target with a Math.min clamp corrects the landing.
      const container = scrollContainerRef.current;
      if (!container) return;

      if (id === "event") {
        container.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        const heading = document.querySelector("#section-venue h3") as HTMLElement | null;
        const chipsBar = containerRef.current?.parentElement;
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (heading && chipsBar) {
          const containerTop = container.getBoundingClientRect().top;
          const headingAbs =
            heading.getBoundingClientRect().top - containerTop + container.scrollTop;
          // Do NOT use chipsBar.BCR.bottom here — on the first click the chips bar
          // has not yet become sticky (it sticks only after scrolling past its natural
          // flow position, ~414px down). BCR.bottom at scrollTop=0 returns the natural
          // position (~555px), giving a stickyOffset that's ~414px too large and an
          // h3Target that's far too small. The second click works only because the bar
          // is already sticky by then, giving the correct 141px.
          //
          // Instead, derive the sticky bottom from the bar's CSS top + rendered height.
          // This is constant and correct regardless of current scroll position.
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
