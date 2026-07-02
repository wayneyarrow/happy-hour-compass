"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MerchandisableGuide } from "@/lib/data/contentGuideDistribution";
import type { DistributionChannelKey } from "@/lib/data/contentGuideDistributionShared";
import {
  addGuidePlacementAction,
  removeGuidePlacementAction,
  toggleGuidePlacementActiveAction,
  moveGuidePlacementAction,
} from "./actions";

type Props = {
  guide: MerchandisableGuide;
  channelKey: DistributionChannelKey;
  marketId: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
};

const STATUS_BADGE: Record<string, string> = {
  published: "bg-emerald-100 text-emerald-700 border border-emerald-300",
  draft: "bg-gray-100 text-gray-500 border border-gray-300",
  scheduled: "bg-sky-100 text-sky-700 border border-sky-300",
  expired: "bg-red-100 text-red-600 border border-red-300",
};

export function GuidePlacementRow({ guide, channelKey, marketId, canMoveUp, canMoveDown }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = () => router.refresh();

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const result = await addGuidePlacementAction(guide.guideId, channelKey);
      if (!result.success) setError(result.error ?? "Failed to add.");
      refresh();
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeGuidePlacementAction(guide.guideId, channelKey);
      if (!result.success) setError(result.error ?? "Failed to remove.");
      refresh();
    });
  }

  function handleToggleActive(checked: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await toggleGuidePlacementActiveAction(guide.guideId, channelKey, checked);
      if (!result.success) setError(result.error ?? "Failed to update.");
      refresh();
    });
  }

  function handleMove(direction: -1 | 1) {
    setError(null);
    startTransition(async () => {
      const result = await moveGuidePlacementAction(channelKey, marketId, guide.guideId, direction);
      if (!result.success) setError(result.error ?? "Failed to reorder.");
      refresh();
    });
  }

  return (
    <div
      className={`border-b border-gray-100 last:border-0 text-sm transition-opacity ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-4 py-3">
        {/* Title + type/status — flex-1, links to CP edit page */}
        <div className="flex-1 min-w-0">
          <Link
            href={`/control-panel/content-engine/${guide.guideId}/edit`}
            className="font-medium text-slate-800 hover:text-amber-700 hover:underline underline-offset-2 truncate block transition-colors"
          >
            {guide.title}
          </Link>
          <span className="text-xs text-gray-400 capitalize">
            {guide.guideType.replace("_", " ")}
          </span>
        </div>

        {/* Status badge */}
        <div className="shrink-0">
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
              STATUS_BADGE[guide.status] ?? STATUS_BADGE.draft
            }`}
          >
            {guide.status}
          </span>
        </div>

        {guide.isMerchandised ? (
          <>
            {/* Reorder */}
            <div className="shrink-0 flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleMove(-1)}
                disabled={!canMoveUp || isPending}
                className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label={`Move ${guide.title} up`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => handleMove(1)}
                disabled={!canMoveDown || isPending}
                className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label={`Move ${guide.title} down`}
              >
                ↓
              </button>
            </div>

            {/* Active toggle */}
            <label className="shrink-0 flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={guide.isActive}
                onChange={(e) => handleToggleActive(e.target.checked)}
                disabled={isPending}
                className="rounded border-gray-300 text-amber-500 focus:ring-amber-400 cursor-pointer"
              />
              <span className="text-xs text-gray-500">Active</span>
            </label>

            {/* Remove */}
            <button
              type="button"
              onClick={handleRemove}
              disabled={isPending}
              className="shrink-0 text-xs px-2.5 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors disabled:opacity-50"
            >
              Remove
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleAdd}
            disabled={isPending}
            className="shrink-0 text-xs px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded font-medium transition-colors disabled:opacity-50"
          >
            Add to channel
          </button>
        )}
      </div>

      {error && <p className="px-4 pb-3 text-xs text-red-600">{error}</p>}
    </div>
  );
}
