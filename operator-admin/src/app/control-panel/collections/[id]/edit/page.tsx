export const dynamic = "force-dynamic";
export const metadata = { title: "Edit Collection — Collections" };

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCollectionById,
  getCollectionFormGeography,
  getEligibleGuidesForCollection,
} from "@/lib/data/collections";
import CollectionForm from "../../CollectionForm";

export default async function EditCollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  const { id } = await params;
  const [collection, { markets, cities }, { success }] = await Promise.all([
    getCollectionById(id),
    getCollectionFormGeography(),
    searchParams,
  ]);

  if (!collection) notFound();

  // Guide candidates are the only server-side data the Resolved Collection
  // section needs up front — Venue/Event resolution now runs on demand via
  // the editor's own "Generate Collection" action (generateCollectionResultAction),
  // not a page-load computation, so an algorithmic Collection's resolved list
  // no longer needs to be (re)computed on every visit to this page.
  const guideCandidates =
    collection.collectionType === "guide"
      ? await getEligibleGuidesForCollection(collection.marketId, collection.cityId)
      : [];

  const successMessage =
    success === "created" ? "Collection created." : success === "updated" ? "Collection saved." : null;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <Link
          href="/control-panel/collections"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block"
        >
          ← Collections
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Edit Collection</h1>
        <p className="mt-1 text-sm text-gray-500">{collection.name}</p>
      </div>

      {successMessage && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-5 py-3 text-sm text-green-700">
          {successMessage}
        </div>
      )}

      <CollectionForm
        mode="edit"
        initialCollection={collection}
        markets={markets}
        cities={cities}
        guideCandidates={guideCandidates}
      />
    </div>
  );
}
