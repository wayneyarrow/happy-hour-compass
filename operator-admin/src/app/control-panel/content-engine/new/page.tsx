export const dynamic = "force-dynamic";
export const metadata = { title: "New Guide — Content Engine" };

import Link from "next/link";
import { getGuideFormGeography } from "@/lib/data/contentGuides";
import GuideForm from "../GuideForm";

export default async function NewContentGuidePage() {
  const { markets, cities, neighbourhoods } = await getGuideFormGeography();

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <Link
          href="/control-panel/content-engine"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block"
        >
          ← Content Engine
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">New Guide</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create a new Venue Guide or Event Guide.
        </p>
      </div>

      <GuideForm mode="create" markets={markets} cities={cities} neighbourhoods={neighbourhoods} />
    </div>
  );
}
