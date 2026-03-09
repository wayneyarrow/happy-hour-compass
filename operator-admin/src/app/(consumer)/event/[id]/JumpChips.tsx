"use client";

import { useState, useEffect, useCallback } from "react";

type ChipId = "event" | "venue";

/**
 * Jump-to navigation chips for the event detail page.
 *
 * Mirrors the original app's #event-tabs behavior:
 *  - Active chip fills with blue (#3b82f6), white text, semibold
 *    (.section-nav-item.active)
 *  - Scroll listener updates the active chip as the user scrolls between
 *    #section-event and #section-venue (handleEventDetailScroll logic)
 *  - Clicking a chip smooth-scrolls to the target section and sets it active
 *    (scrollToEventSection logic)
 */
export function JumpChips() {
  const [activeId, setActiveId] = useState<ChipId>("event");

  const updateActiveFromScroll = useCallback(() => {
    const eventSection = document.getElementById("section-event");
    const venueSection = document.getElementById("section-venue");
    if (!eventSection || !venueSection) return;

    // Use 160px offset to account for the two sticky bars (header ~61px + chips nav ~80px).
    // Matches original's "scrollTop + 100" threshold relative to the inner scroll container.
    const scrollOffset = window.scrollY + 160;
    const venueTop =
      venueSection.getBoundingClientRect().top + window.scrollY;
    const eventTop =
      eventSection.getBoundingClientRect().top + window.scrollY;

    if (scrollOffset >= venueTop) {
      setActiveId("venue");
    } else if (scrollOffset >= eventTop) {
      setActiveId("event");
    }
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", updateActiveFromScroll, { passive: true });
    // Set initial active state on mount
    updateActiveFromScroll();
    return () => window.removeEventListener("scroll", updateActiveFromScroll);
  }, [updateActiveFromScroll]);

  const scrollToSection = (id: ChipId) => {
    const section = document.getElementById(`section-${id}`);
    if (section) {
      // Subtract ~150px so the section scrolls below both sticky bars.
      const top =
        section.getBoundingClientRect().top + window.scrollY - 150;
      window.scrollTo({ top, behavior: "smooth" });
    }
    setActiveId(id);
  };

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
            /* .section-nav-item / .section-nav-item.active */
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
