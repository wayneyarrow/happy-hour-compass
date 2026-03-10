import Link from "next/link";

/**
 * Claim detail page — placeholder.
 * Next task: implement full trust-signal review panel and approve/reject/needs-more-info actions.
 */
export default async function ClaimDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="max-w-3xl">
      {/* Back nav */}
      <Link
        href="/control-panel/claims"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-6 transition-colors"
      >
        <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
        </svg>
        Back to Claims
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Claim Review</h1>
        <p className="mt-1 text-sm text-gray-500 font-mono">{id}</p>
      </div>

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
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
            />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-slate-900 mb-1">Claim detail coming next</h2>
        <p className="text-sm text-gray-500 max-w-sm mx-auto">
          This page will show trust signals, claimant details, and review actions (approve, reject, request more info).
        </p>
      </div>
    </div>
  );
}
