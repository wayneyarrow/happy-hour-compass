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

      <VenueFunnelBoard lanes={data.lanes} />
    </div>
  );
}
