"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { BrowserMockFrame } from "./BrowserMockFrame";

/**
 * Interactive, story-driven product tour: a tab strip that switches a
 * large screenshot + headline + copy + business outcome panel. Built for
 * the business page's "See Happy Hour Compass in Action" section
 * (Business Funnel Blueprint, Section 6), kept generic (slides passed as
 * props) so any future business page can drop in its own tour.
 *
 * Implements the standard WAI-ARIA tabs pattern: roving tabindex, arrow
 * key / Home / End navigation, aria-selected/aria-controls wiring. Each
 * slide's outcome line is the "business outcome" the blueprint calls for —
 * shown as the closing statement under the copy, not the headline.
 */

export type ProductTourSlide = {
  id: string;
  tabLabel: string;
  headline: string;
  copy: string;
  outcome: string;
  image?: { src: string; alt: string; fit?: "cover" | "contain" };
  /** Custom visual content, in place of a single `image` (e.g. a multi-screenshot composite). */
  visual?: ReactNode;
};

type Props = {
  slides: ProductTourSlide[];
};

export function ProductTour({ slides }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();

  function activate(index: number) {
    const clamped = (index + slides.length) % slides.length;
    setActiveIndex(clamped);
    tabRefs.current[clamped]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        activate(activeIndex + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        activate(activeIndex - 1);
        break;
      case "Home":
        e.preventDefault();
        activate(0);
        break;
      case "End":
        e.preventDefault();
        activate(slides.length - 1);
        break;
    }
  }

  const active = slides[activeIndex];

  return (
    <div>
      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Product tour"
        onKeyDown={onKeyDown}
        className="flex flex-wrap justify-center gap-1 bg-gray-100 rounded-full p-1 w-fit mx-auto"
      >
        {slides.map((slide, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={slide.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${i}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${i}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveIndex(i)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                isActive ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {slide.tabLabel}
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <div
        role="tabpanel"
        id={`${baseId}-panel-${activeIndex}`}
        aria-labelledby={`${baseId}-tab-${activeIndex}`}
        tabIndex={0}
        className="mt-10 md:mt-14 grid md:grid-cols-2 gap-10 md:gap-14 items-center focus-visible:outline-none"
      >
        <div className="order-2 md:order-1 text-center md:text-left">
          <h3 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
            {active.headline}
          </h3>
          <p className="mt-4 text-base text-gray-500 leading-relaxed">{active.copy}</p>
          <p className="mt-5 text-sm font-semibold text-amber-600">{active.outcome}</p>
        </div>
        <div className="order-1 md:order-2">
          <BrowserMockFrame
            image={active.visual ? undefined : active.image}
            placeholderLabel={active.tabLabel}
          >
            {active.visual}
          </BrowserMockFrame>
        </div>
      </div>
    </div>
  );
}
