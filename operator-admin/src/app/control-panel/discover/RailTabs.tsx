"use client";

import Link from "next/link";
import { RAIL_KEYS, RAIL_LABELS, type RailKey } from "@/lib/data/discoverOverridesShared";

type Props = {
  currentRail: RailKey;
  counts: Record<RailKey, number>;
};

export function RailTabs({ currentRail, counts }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-6">
      {RAIL_KEYS.map((key) => {
        const isActive = key === currentRail;
        return (
          <Link
            key={key}
            href={`/control-panel/discover?rail=${key}`}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-amber-100 text-amber-800 border border-amber-300"
                : "bg-white text-gray-600 border border-gray-200 hover:border-amber-200 hover:text-amber-700"
            }`}
          >
            {RAIL_LABELS[key]}
            <span
              className={`ml-1.5 text-xs font-normal ${
                isActive ? "text-amber-600" : "text-gray-400"
              }`}
            >
              {counts[key]}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
