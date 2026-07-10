export const dynamic = "force-dynamic";
export const metadata = { title: "New Collection — Collections" };

import Link from "next/link";
import { getCollectionFormGeography } from "@/lib/data/collections";
import CollectionForm from "../CollectionForm";

export default async function NewCollectionPage() {
  const { markets, cities } = await getCollectionFormGeography();

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <Link
          href="/control-panel/collections"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block"
        >
          ← Collections
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">New Collection</h1>
        <p className="mt-1 text-sm text-gray-500">
          The Collection is created first with its type, geography, and curation method. Content selection
          and refinement — choosing venues, events, or guides, or generating and refining an algorithm&apos;s
          result — happen on the next screen.
        </p>
      </div>

      <CollectionForm mode="create" markets={markets} cities={cities} />
    </div>
  );
}
