import { createAdminClient } from "@/lib/supabase/server";
import { HhReviewTable } from "./HhReviewTable";
import type { ReviewVenue } from "./HhReviewTable";

/**
 * Control Panel panel listing every venue flagged hh_times_needs_review = true.
 * These venues have hh_times values that could not be auto-normalized during the
 * bulk normalization pass and require a human to supply correct day/time data.
 *
 * Server component — data fetched at request time via the admin client.
 */
export async function QaHhReviewPanel() {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("venues")
    .select("id, name, city, hh_times")
    .eq("hh_times_needs_review", true)
    .order("name", { ascending: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const venues = (data ?? []) as ReviewVenue[];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-slate-900">
          QA: HH Times Manual Review
        </h2>
        {!error && (
          <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
            {venues.length} venue{venues.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-1">
        Venues whose{" "}
        <code className="bg-gray-100 px-1 rounded text-xs">hh_times</code> could
        not be auto-normalized — day/time context is missing or ambiguous.
      </p>
      <p className="text-xs text-gray-400 mb-4">
        Click <strong>Fix</strong> on any row to open the structured editor, enter correct
        times, and save. The flag is cleared automatically and the venue is published if
        eligible.
      </p>

      {/* Error */}
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <strong>Error loading venues:</strong> {error.message}
        </div>
      )}

      {/* All clear */}
      {!error && venues.length === 0 && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          ✓ No venues require HH review.
        </p>
      )}

      {/* Venue list — rendered as an interactive client component with Fix buttons */}
      {!error && venues.length > 0 && <HhReviewTable venues={venues} />}
    </div>
  );
}
