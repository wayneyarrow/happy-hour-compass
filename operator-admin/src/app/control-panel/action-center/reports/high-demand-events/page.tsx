export const dynamic = "force-dynamic";
export const metadata = { title: "Upcoming High Demand Events — Action Center" };

import Link from "next/link";
import { getHighDemandEvents } from "@/lib/data/actionCenter";
import ReportTable from "./ReportTable";

export default async function HighDemandEventsPage() {
  const rows = await getHighDemandEvents();

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <Link href="/control-panel/action-center"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block">
          ← Action Center
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Upcoming High Demand Events</h1>
        <p className="mt-1 text-sm text-gray-500">
          Future events already generating 5+ consumer views. These are candidates for promotion,
          featuring, or outreach to encourage recurring events and plan upgrades.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-sm font-medium text-slate-700 mb-1">No upcoming high demand events</p>
          <p className="text-xs text-gray-400">
            Future events with 5+ views in the last 30 days will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 text-sm text-blue-800">
            <strong>{rows.length}</strong> upcoming {rows.length === 1 ? "event" : "events"} with 5+ views in the last 30 days.
          </div>
          <ReportTable rows={rows} />
        </>
      )}
    </div>
  );
}
