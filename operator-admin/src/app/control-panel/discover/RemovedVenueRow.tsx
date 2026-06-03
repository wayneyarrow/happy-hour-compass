"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConsumerVenue } from "@/lib/data/venues";
import type { RailKey } from "@/lib/data/discoverOverridesShared";
import { EXCLUDE_REASON_TYPES } from "@/lib/data/discoverOverridesShared";
import { restoreToAlgorithmAction } from "./actions";

type Props = {
  venue: ConsumerVenue;
  railKey: RailKey;
  reasonType: string | null;
  note: string | null;
  removedBy: string | null;
};

function reasonLabel(value: string | null): string | null {
  if (!value) return null;
  return EXCLUDE_REASON_TYPES.find((r) => r.value === value)?.label ?? value;
}

export function RemovedVenueRow({ venue, railKey, reasonType, note, removedBy }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleRestore = () => {
    startTransition(async () => {
      await restoreToAlgorithmAction(railKey, venue.venueUuid);
      router.refresh();
    });
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 border-b border-red-50 last:border-0 text-sm ${
        isPending ? "opacity-60" : ""
      }`}
    >
      <div className="flex-1 min-w-0">
        <span className="font-medium text-slate-700 truncate block">{venue.name}</span>
        <span className="text-xs text-gray-400">
          {reasonLabel(reasonType) && (
            <span className="mr-2">{reasonLabel(reasonType)}</span>
          )}
          {note && <span className="italic">&ldquo;{note}&rdquo;</span>}
          {removedBy && (
            <span className="ml-1 text-gray-300">— {removedBy}</span>
          )}
        </span>
      </div>
      <button
        onClick={handleRestore}
        disabled={isPending}
        className="shrink-0 text-xs px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-600 rounded transition-colors disabled:opacity-50"
      >
        {isPending ? "Restoring…" : "Restore to algorithm"}
      </button>
    </div>
  );
}
