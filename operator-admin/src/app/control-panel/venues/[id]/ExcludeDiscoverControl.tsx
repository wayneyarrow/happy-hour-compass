"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateVenueExcludeFromDiscoverAction } from "./actions";

type Props = {
  venueId: string;
  initialValue: boolean;
};

export function ExcludeDiscoverControl({ venueId, initialValue }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [excluded, setExcluded] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = (checked: boolean) => {
    setError(null);
    const prev = excluded;
    setExcluded(checked); // optimistic update
    startTransition(async () => {
      const result = await updateVenueExcludeFromDiscoverAction(venueId, checked);
      if (!result.success) {
        setError(result.error);
        setExcluded(prev); // revert on failure
        return;
      }
      router.refresh();
    });
  };

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        excluded ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"
      }`}
    >
      <label className={`flex items-start gap-3 ${isPending ? "opacity-60" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          checked={excluded}
          disabled={isPending}
          onChange={(e) => handleToggle(e.target.checked)}
          className="mt-0.5 rounded border-gray-300 text-red-500 focus:ring-red-400 cursor-pointer"
        />
        <div className="flex-1">
          <span className={`text-sm font-medium ${excluded ? "text-red-700" : "text-gray-700"}`}>
            Exclude From Discover
          </span>
          <p className="text-xs text-gray-500 mt-0.5">
            When enabled, this venue is removed from all Consumer Home discovery
            rails and from Search where discover eligibility applies. This is a
            venue-wide flag — it overrides any rail-level inclusions.
          </p>
          {excluded && (
            <p className="text-xs text-red-600 font-medium mt-1.5">
              Currently excluded from all discovery.
            </p>
          )}
        </div>
      </label>
      {error && (
        <p className="mt-2 text-xs text-red-600 pl-6">{error}</p>
      )}
    </div>
  );
}
