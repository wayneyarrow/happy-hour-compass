export const dynamic = "force-dynamic";
export const metadata = { title: "Operator Activation Reviews — Action Center" };

import Link from "next/link";
import { getOperatorActivationReviews } from "@/lib/activation/activationReviews";
import ReportTable from "./ReportTable";

export default async function OperatorActivationReviewsPage() {
  const rows = await getOperatorActivationReviews();

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link href="/control-panel/action-center"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block">
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Operator activation reviews</h1>
        <p className="mt-1 text-sm text-gray-500">
          Claims and Add Your Venue submissions whose operator never activated their account. Each row is a live,
          unreleased activation lifecycle needing founder attention — the deadline has passed, it has formally
          expired, the automated reminder worker exhausted its final attempt early, or an expired record&rsquo;s
          founder Slack/email notification never completed. Already-activated and already-released records are
          never shown here.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-sm font-medium text-slate-700 mb-1">Nothing needs review</p>
          <p className="text-xs text-gray-400">No stalled activation lifecycles are currently actionable.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
            <strong>{rows.length}</strong> {rows.length === 1 ? "activation" : "activations"} need review.
          </div>
          <ReportTable rows={rows} />
        </>
      )}
    </div>
  );
}
