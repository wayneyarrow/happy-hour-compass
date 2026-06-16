export const dynamic = "force-dynamic";
export const metadata = { title: "Seeded Venues Needing Claims — Action Center" };

import Link from "next/link";
import { getSeededNeedingClaims } from "@/lib/data/actionCenter";
import ReportTable from "./ReportTable";

export default async function SeededNeedingClaimsPage() {
  const rows = await getSeededNeedingClaims();

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link
          href="/control-panel/action-center"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block"
        >
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Seeded Venues Needing Claims</h1>
        <p className="mt-1 text-sm text-gray-500">
          Seeded inventory with no operator attached. Sort by Venue Views to find high-demand
          venues that should be converted into operator accounts.
        </p>
      </div>

      <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
        <strong>{rows.length}</strong> seeded {rows.length === 1 ? "venue" : "venues"} with no operator attached.
      </div>

      <ReportTable rows={rows} />
    </div>
  );
}
