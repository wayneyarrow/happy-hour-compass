export const dynamic = "force-dynamic";
export const metadata = { title: "Unused Search Tag Capacity — Action Center" };

import Link from "next/link";
import { getUnusedSearchTagsOpportunities } from "@/lib/data/actionCenter";
import ReportTable from "./ReportTable";

export default async function UnusedSearchTagsPage() {
  const rows = await getUnusedSearchTagsOpportunities();

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link href="/control-panel/action-center"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block">
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Unused Search Tag Capacity</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pro and Premium venues that aren&apos;t using all the Search Tags included in their
          subscription. A quick customer-success outreach opportunity — help them use a feature
          they&apos;re already paying for.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-sm font-medium text-slate-700 mb-1">No unused Search Tag capacity found</p>
          <p className="text-xs text-gray-400">
            Venues appear here when their operator is on Pro or Premium and they have used fewer
            Search Tags than their plan allows.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-5 py-3 text-sm text-green-800">
            <strong>{rows.length}</strong> {rows.length === 1 ? "venue has" : "venues have"} unused Search Tag capacity.
          </div>
          <ReportTable rows={rows} />
        </>
      )}
    </div>
  );
}
