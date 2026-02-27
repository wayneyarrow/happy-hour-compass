"use client";

import { useState } from "react";

type Props = {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

/**
 * Accordion section that keeps children always mounted in the React tree.
 * Uses CSS `hidden` / visible classes instead of conditional rendering so that
 * HhTimesForm's controlled state is never reset when the section is collapsed.
 */
export default function HhTimesSection({
  title,
  description,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div>
          <h3 className="text-base font-semibold text-gray-800">{title}</h3>
          {description && (
            <p className="text-xs text-gray-400 mt-0.5">{description}</p>
          )}
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 shrink-0 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Always rendered — hidden via CSS so form state is never reset */}
      <div
        className={`px-6 pb-6 pt-3 border-t border-gray-100 ${
          open ? "" : "hidden"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
