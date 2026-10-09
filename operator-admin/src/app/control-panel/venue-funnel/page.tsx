export const dynamic = "force-dynamic";
export const metadata = { title: "Venue Funnel" };

import { getVenueFunnelData } from "@/lib/data/venueFunnel";
import VenueFunnelBoard from "./VenueFunnelBoard";

export default async function VenueFunnelPage() {
  const data = await getVenueFunnelData();

  return (
    <div className="max-w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Venue Funnel</h1>
        <p className="mt-1 text-sm text-gray-500">
          Where every claimed/submitted venue currently sits in its HHC lifecycle — left to right,
          claim/submission through paid plan. Lane state is derived automatically; nothing here is
          manually dragged between lanes.
        </p>
      </div>

      {data.grantDataUnavailable && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Comp/Trial grant data couldn&rsquo;t be loaded. Venues are placed by billing plan only, so comped or
          trial venues may be missing from Paid Plan. Refresh to try again.
        </div>
      )}

      <VenueFunnelBoard lanes={data.lanes} />
    </div>
  );
}
