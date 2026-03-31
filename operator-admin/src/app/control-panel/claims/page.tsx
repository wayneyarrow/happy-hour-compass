import { getClaimsForReview } from "@/lib/data/claims";
import ClaimsTable from "./ClaimsTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Claims" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ClaimsPage() {
  const { claims, error } = await getClaimsForReview();

  return (
    <div className="max-w-7xl">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Claims</h1>
          <p className="mt-1 text-sm text-gray-500">
            Venue ownership claims submitted by operators.
          </p>
        </div>
        {claims.length > 0 && (
          <span className="text-sm text-gray-500">
            {claims.length} {claims.length === 1 ? "claim" : "claims"}
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!error && claims.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
            <svg
              className="w-6 h-6 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-slate-900 mb-1">No claims yet</h2>
          <p className="text-sm text-gray-500 max-w-xs mx-auto">
            Venue ownership claims submitted through the consumer app will appear here for review.
          </p>
        </div>
      )}

      {/* Claims table */}
      {!error && claims.length > 0 && (
        <ClaimsTable
          rows={claims.map((c) => ({ ...c, submitted: formatDate(c.created_at) }))}
        />
      )}
    </div>
  );
}
