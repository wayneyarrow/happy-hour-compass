"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type ChipId = "event" | "venue";

/**
 * Trigger line (px from viewport top).
 *
 * Sticky header  ~61 px  (py-4 + 18 px title text + 1 px border)
 * Jump-chips nav ~80 px  (py-3 + "Jump to" label + chip row)
 * Total           141 px
 *
 * Venue becomes active when its top edge crosses upward through this line,
 * i.e. when the Venue section starts occupying the top of the visible area.
 */
const TRIGGER = 141;

/**
 * Returns the active chip based purely on where the Venue section top
 * sits relative to the trigger line.
 *
 *   venueTop ≤ TRIGGER  →  "venue"  (Venue has entered the content area)
 *   venueTop  > TRIGGER  →  "event"  (still above the Venue section)
 *
 * This is the only comparison needed for a two-section page. It is
 * symmetric: scroll down crosses the line once → Venue active; scroll
 * back up crosses back → Event active. No priority rules, no area math.
 */
function resolveActive(): ChipId {
  const venueEl = document.getElementById("section-venue");
  if (!venueEl) return "event";
  return venueEl.getBoundingClientRect().top <= TRIGGER ? "venue" : "event";
}

/**
 * Why the previous "visible pixels" approach was wrong
 * ─────────────────────────────────────────────────────
 * visiblePx(venue) > visiblePx(event) sounds symmetric but isn't on this
 * page. When the Event section is tall (long description), its lower portion
 * stays in the viewport while the Venue section's upper portion is still
 * below the fold. The crossover only occurs when Venue has accumulated enough
 * visible pixels to exceed Event's remaining pixels — which can happen with
 * Venue's heading as far as 350–400 px down the screen (bottom third), well
 * after the user perceives Venue as the active section.
 *
 * The threshold rule switches the instant the Venue heading enters the top of
 * the content area, which is exactly what feels natural.
 *
 * Click lock
 * ──────────
 * Clicking a chip sets activeId immediately (instant feedback) and locks
 * the scroll handler for ~900 ms so scroll events fired during smooth
 * scrolling cannot flip the chip back. One final sync after the lock
 * releases aligns the chip with the actual settled position.
 */
export function JumpChips() {
  const [activeId, setActiveId] = useState<ChipId>("event");
  const clickLockRef = useRef(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncFromScroll = useCallback(() => {
    if (clickLockRef.current) return;
    setActiveId(resolveActive());
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", syncFromScroll, { passive: true });
    syncFromScroll();
    return () => window.removeEventListener("scroll", syncFromScroll);
  }, [syncFromScroll]);

  const scrollToSection = useCallback(
    (id: ChipId) => {
      setActiveId(id);

      clickLockRef.current = true;
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
      lockTimerRef.current = setTimeout(() => {
        clickLockRef.current = false;
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
