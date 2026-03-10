/**
 * Claims — Admin Control Panel
 *
 * Next task: implement the real claims list here.
 * - Query the `venue_claims` table (or equivalent) ordered by created_at desc
 * - Display claim rows: venue name, operator email, submitted date, status badge
 * - Link each row to /control-panel/claims/[id] for detail + review actions
 */
export default function ClaimsPage() {
  return (
    <div className="max-w-5xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Claims</h1>
        <p className="mt-1 text-sm text-gray-500">
          Venue ownership claims submitted by operators, waiting for review.
        </p>
      </div>

      {/* Placeholder — ready for the real implementation */}
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-50 mb-4">
          <svg
            className="w-6 h-6 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
            />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-slate-900 mb-1">Claims list coming next</h2>
        <p className="text-sm text-gray-500 max-w-sm mx-auto">
          This page will display all submitted venue ownership claims with status, operator info, and review actions.
        </p>
      </div>
    </div>
  );
}
