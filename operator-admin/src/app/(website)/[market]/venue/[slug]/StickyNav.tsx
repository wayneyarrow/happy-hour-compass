"use client";

import { useState, useEffect, useRef } from "react";

type Section = { id: string; label: string };

type Props = {
  sections: Section[];
};

/**
 * Sticky horizontal section nav for the website Venue Detail page.
 * Sticks below the WebsiteHeader (h-16 mobile / h-[72px] desktop).
 * Active section tracks scroll position via IntersectionObserver.
 */
export function StickyNav({ sections }: Props) {
  const [activeSection, setActiveSection] = useState<string>(sections[0]?.id ?? "");
  const entryMap = useRef(new Map<string, IntersectionObserverEntry>());
  // Freeze sections at mount — they're derived from server data and never change client-side.
  const sectionsRef = useRef(sections);

  useEffect(() => {
    const secs = sectionsRef.current;
    if (secs.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entryMap.current.set(entry.target.id, entry);
        });

        // Pick the topmost visible section within the observation band.
        const visible = secs.filter((s) => entryMap.current.get(s.id)?.isIntersecting);
        if (visible.length === 0) return;

        const topmost = visible.reduce((prev, curr) => {
          const prevTop = entryMap.current.get(prev.id)?.boundingClientRect.top ?? Infinity;
          const currTop = entryMap.current.get(curr.id)?.boundingClientRect.top ?? Infinity;
          return currTop < prevTop ? curr : prev;
        });

        setActiveSection(topmost.id);
      },
      // Top inset accounts for header (72px) + sticky nav (~48px) + small buffer.
      // Bottom inset clips to the upper ~55% of the viewport so sections near the
      // bottom don't compete with those already anchored near the top.
      { rootMargin: "-124px 0px -45% 0px", threshold: 0 }
    );

    secs.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    setActiveSection(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (sections.length === 0) return null;

  return (
    <div className="sticky top-16 md:top-[72px] z-40 -mx-6 lg:-mx-10 px-6 lg:px-10 bg-white border-b border-gray-100">
      <div className="flex items-center gap-0 overflow-x-auto scrollbar-hide">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={(e) => handleClick(e, section.id)}
            className={[
              "shrink-0 px-4 py-3.5 text-sm font-medium border-b-2 transition-all duration-200 whitespace-nowrap",
              activeSection === section.id
                ? "text-gray-900 border-amber-500"
                : "text-gray-500 border-transparent hover:text-gray-800 hover:border-gray-200",
            ].join(" ")}
          >
            {section.label}
          </a>
        ))}
      </div>
    </div>
  );
}
