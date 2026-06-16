export const dynamic = "force-dynamic";
export const metadata = { title: "Inactive Operators — Action Center" };

import Link from "next/link";
import { getInactiveOperators } from "@/lib/data/actionCenter";
import ReportTable from "./ReportTable";

export default async function InactiveOperatorsPage() {
  const rows = await getInactiveOperators();

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link href="/control-panel/action-center"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block">
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Inactive Operators</h1>
        <p className="mt-1 text-sm text-gray-500">
          Operators who haven&apos;t logged in for 30+ days. Venues at risk of abandonment.
          Sorted by longest inactive period first.
        </p>
      </div>

      <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-800">
        <strong>{rows.length}</strong> {rows.length === 1 ? "venue" : "venues"} with inactive operators (30+ days since last login).
      </div>

      <ReportTable rows={rows} />
    </div>
  );
}
