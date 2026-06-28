"use client";

import { useState } from "react";
import type { Market } from "@/lib/markets";
import { MarketModal } from "@/app/(consumer)/MarketModal";

type Props = {
  market: Market;
  /** Live venue count for the active market. Pass 0 during loading/error states. */
  resultCount: number;
  className?: string;
};

export default function SearchContextHeader({ market, resultCount, className = "" }: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className={className}>
      <h1 className="text-2xl font-bold text-gray-900 tracking-tight leading-tight">
        Happy Hours
      </h1>

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          aria-label={`Currently browsing ${market.name}. Tap to change market.`}
          className="
            inline-flex items-center gap-2 px-4 py-2
            bg-white border border-gray-200 rounded-full
            shadow-sm hover:shadow-md hover:border-gray-300
            text-sm font-medium text-gray-700
            transition-all duration-200
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2
          "
        >
          <svg
            className="w-4 h-4 text-amber-500 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span>{market.name}</span>
          <svg
            className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        <span className="text-xs text-gray-400">
          {resultCount.toLocaleString()} {resultCount === 1 ? "venue" : "venues"}
        </span>
      </div>

      {isModalOpen && (
        <MarketModal
          activeMarketId={market.id}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
}
