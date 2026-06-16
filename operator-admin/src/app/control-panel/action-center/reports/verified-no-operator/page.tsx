export const dynamic = "force-dynamic";
export const metadata = { title: "Verified Venues Without Operators — Action Center" };

import Link from "next/link";
import { getVerifiedWithoutOperators } from "@/lib/data/actionCenter";
import ReportTable from "./ReportTable";

export default async function VerifiedNoOperatorPage() {
  const rows = await getVerifiedWithoutOperators();

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link href="/control-panel/action-center"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block">
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Verified Venues Without Operators</h1>
        <p className="mt-1 text-sm text-gray-500">
          Venues with <code className="font-mono text-xs bg-gray-100 px-1 rounded">is_verified = true</code> but
          no operator attached — a lifecycle leak. These venues completed verification but never converted
          to active operator accounts.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-sm font-medium text-slate-700 mb-1">No lifecycle leaks found</p>
          <p className="text-xs text-gray-400">All verified venues have an operator attached.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
            <strong>{rows.length}</strong> verified {rows.length === 1 ? "venue" : "venues"} with no operator attached.
          </div>
          <ReportTable rows={rows} />
        </>
      )}
    </div>
  );
}
