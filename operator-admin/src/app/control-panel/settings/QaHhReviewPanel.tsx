import { createAdminClient } from "@/lib/supabase/server";

type ReviewVenue = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  hh_times: string | null;
};

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
    .select("id, slug, name, city, hh_times")
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
        Fix the raw string via the Supabase SQL editor, then set{" "}
        <code className="bg-gray-100 px-1 rounded">hh_times_needs_review = false</code>{" "}
        to clear the flag. Click a venue name to open it in the Venues list.
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

      {/* Venue list */}
      {!error && venues.length > 0 && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-4 py-2.5 font-medium text-gray-700">Venue</th>
                <th className="px-4 py-2.5 font-medium text-gray-700 w-28">City</th>
                <th className="px-4 py-2.5 font-medium text-gray-700">
                  hh_times{" "}
                  <span className="font-normal text-gray-400">(raw)</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {venues.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 align-top">
                    <a
                      href="/control-panel/venues"
                      className="font-medium text-slate-800 hover:text-amber-600 transition-colors"
                      title={`Open ${v.name} in Venues`}
                    >
                      {v.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 align-top text-gray-500">
                    {v.city ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {v.hh_times ? (
                      <span
                        className="font-mono text-xs text-gray-500 break-all"
                        title={v.hh_times}
                      >
                        {v.hh_times.length > 90
                          ? v.hh_times.slice(0, 90) + "…"
                          : v.hh_times}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
