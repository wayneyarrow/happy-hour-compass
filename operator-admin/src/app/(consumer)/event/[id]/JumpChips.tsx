"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type ChipId = "event" | "venue";

/**
 * Approximate height (px) of the two sticky bars:
 *   sticky header  ~61 px  (py-4 + 18 px text + 1 px border)
 *   jump-chips nav ~80 px  (py-3 + "Jump to" label + chip row)
 *
 * Used to exclude the covered area from visible-pixel calculations so
 * the active-section comparison is based only on what the user can
 * actually see below the sticky UI.
 */
const STICKY_HEIGHT = 141;

/**
 * Returns how many pixels of `el` are visible in the viewport below the
 * sticky bars. Zero when the element is fully above or fully below the fold.
 */
function visiblePx(el: Element): number {
  const r = el.getBoundingClientRect();
  return Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, STICKY_HEIGHT));
}

/**
 * Jump-to navigation chips for the event detail page.
 *
 * Active-section source of truth (scroll)
 * ─────────────────────────────────────────
 * On each scroll event, we measure how many pixels of #section-event and
 * #section-venue are visible below the sticky bars. Whichever section shows
 * more pixels wins. This produces a single deterministic crossover point —
 * exactly when the two visible heights are equal — so the chip switches at
 * the natural midpoint between sections with no early / late / flickering.
 *
 * Previous IntersectionObserver approach
 * ───────────────────────────────────────
 * The prior implementation tracked section *presence* in a detection zone
 * and applied an "event always wins when both are visible" priority rule.
 * This caused asymmetric timing:
 *   • scrolling down → switch too late  (event only lost after it fully
 *     exited the detection zone, even when venue was already dominant)
 *   • scrolling up   → switch too early (event won the moment its bottom
 *     re-entered the zone, even when venue still filled the screen)
 *
 * Click lock
 * ──────────
 * Clicking a chip sets activeId immediately (instant feedback) and locks
 * the scroll handler for ~900 ms so mid-scroll recalculations don't revert
 * the chip while the page is still traveling to the target section. After the
 * lock releases, one final sync call aligns the chip with the actual position.
 */
export function JumpChips() {
  const [activeId, setActiveId] = useState<ChipId>("event");
  const clickLockRef = useRef(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncFromScroll = useCallback(() => {
    if (clickLockRef.current) return;
    const eventEl = document.getElementById("section-event");
    const venueEl = document.getElementById("section-venue");
    if (!eventEl || !venueEl) return;
    setActiveId(visiblePx(venueEl) > visiblePx(eventEl) ? "venue" : "event");
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", syncFromScroll, { passive: true });
    syncFromScroll();
    return () => window.removeEventListener("scroll", syncFromScroll);
  }, [syncFromScroll]);

  const scrollToSection = useCallback(
    (id: ChipId) => {
      // Instant chip feedback on tap.
      setActiveId(id);

      // Lock the scroll handler so in-flight scroll events don't flip the chip.
      clickLockRef.current = true;
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      lockTimerRef.current = setTimeout(() => {
        clickLockRef.current = false;
        // One final sync after scroll settles to catch any layout shift.
        syncFromScroll();
      }, 900);

      const section = document.getElementById(`section-${id}`);
      if (section) {
        const top = section.getBoundingClientRect().top + window.scrollY - 150;
        window.scrollTo({ top, behavior: "smooth" });
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
    <div className="flex gap-2">
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
