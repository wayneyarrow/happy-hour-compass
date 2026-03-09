"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type ChipId = "event" | "venue";

/**
 * Jump-to navigation chips for the event detail page.
 *
 * Active-state source of truth
 * ─────────────────────────────
 * Active section is tracked with IntersectionObserver rather than a scroll
 * event listener. This eliminates the per-frame math (`scrollY + offset`)
 * that caused flicker: during a smooth scroll the math would resolve to the
 * wrong section mid-flight and flip the chip back.
 *
 * Detection zone: rootMargin "-130px 0px -50% 0px" creates a horizontal strip
 * from 130 px (just past both sticky bars) to the midpoint of the viewport.
 * A section is "active" when any part of it occupies this strip. "event"
 * is always prioritised over "venue" when both are visible (event is above).
 *
 * Click lock
 * ──────────
 * Clicking a chip sets activeId immediately (instant feedback) AND locks the
 * observer for ~900 ms via clickLockRef. This prevents scroll events fired
 * during smooth scrolling from triggering observer callbacks that would flip
 * the chip back to the previous section before the scroll settles.
 */
export function JumpChips() {
  const [activeId, setActiveId] = useState<ChipId>("event");
  const clickLockRef = useRef(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const visibleSections = new Set<ChipId>();

    const observer = new IntersectionObserver(
      (entries) => {
        // While a click-triggered scroll is in flight, ignore observer updates
        // so the chip doesn't flicker mid-scroll.
        if (clickLockRef.current) return;

        entries.forEach((entry) => {
          const rawId = (entry.target.getAttribute("id") ?? "").replace(
            "section-",
            ""
          ) as ChipId;
          if (entry.isIntersecting) {
            visibleSections.add(rawId);
          } else {
            visibleSections.delete(rawId);
          }
        });

        // "event" wins when both are visible — it is always above "venue".
        if (visibleSections.has("event")) {
          setActiveId("event");
        } else if (visibleSections.has("venue")) {
          setActiveId("venue");
        }
        // If neither intersects (scrolled past both) keep current state — no flicker.
      },
      {
        // Strip from 130 px below viewport top (past both sticky bars) down to
        // the midpoint. Sections taller than this strip are still detected because
        // threshold:0 fires on any overlap, not just full containment.
        rootMargin: "-130px 0px -50% 0px",
        threshold: 0,
      }
    );

    const ids: ChipId[] = ["event", "venue"];
    ids.forEach((id) => {
      const el = document.getElementById(`section-${id}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const scrollToSection = useCallback((id: ChipId) => {
    // 1. Instant visual feedback on tap.
    setActiveId(id);

    // 2. Suppress IntersectionObserver for the scroll duration so mid-scroll
    //    intersection states don't revert the chip to the previous section.
    clickLockRef.current = true;
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    lockTimerRef.current = setTimeout(() => {
      clickLockRef.current = false;
    }, 900);

    // 3. Smooth-scroll, subtracting 150 px to clear both sticky bars.
    const section = document.getElementById(`section-${id}`);
    if (section) {
      const top = section.getBoundingClientRect().top + window.scrollY - 150;
      window.scrollTo({ top, behavior: "smooth" });
    }
  }, []);

  // Cleanup lock timer on unmount.
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
