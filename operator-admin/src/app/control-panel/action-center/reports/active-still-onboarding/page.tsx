export const dynamic = "force-dynamic";
export const metadata = { title: "Active Venues Still Onboarding — Action Center" };

import Link from "next/link";
import { getActiveStillOnboarding } from "@/lib/data/actionCenter";
import ReportTable from "./ReportTable";

export default async function ActiveStillOnboardingPage() {
  const rows = await getActiveStillOnboarding();

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link href="/control-panel/action-center"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block">
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Active Venues Still Onboarding</h1>
        <p className="mt-1 text-sm text-gray-500">
          Operators with an active venue who haven&apos;t completed Venue HQ setup.
          Sorted by lowest health score — the most blocked operators first.
        </p>
      </div>

      <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
        <strong>{rows.length}</strong> active {rows.length === 1 ? "venue" : "venues"} with incomplete setup.
      </div>

      <ReportTable rows={rows} />
    </div>
  );
}
