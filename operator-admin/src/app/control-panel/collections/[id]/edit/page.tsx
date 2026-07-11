export const dynamic = "force-dynamic";
export const metadata = { title: "Edit Collection — Collections" };

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCollectionById,
  getCollectionFormGeography,
  getEligibleGuidesForCollection,
} from "@/lib/data/collections";
import { resolveCollectionPreviewById } from "@/lib/data/collectionsPreview";
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

  // Guide candidates are the only other server-side data the Resolved
  // Collection section needs up front — Guide Collections are manual-only,
  // with no algorithm to resolve.
  const guideCandidates =
    collection.collectionType === "guide"
      ? await getEligibleGuidesForCollection(collection.marketId, collection.cityId)
      : [];

  // Algorithmic Collections are generated once, at creation, and then locked
  // (Curation Method/Algorithm/Item Limit can no longer change — see
  // CollectionForm.tsx's module docstring). There is no "Generate"/
  // "Regenerate" button anywhere in the normal Edit flow, so this is the
  // only place a Collection's current base pool + stored overrides ever get
  // resolved — on every visit to this page (fresh creation, a refresh,
  // leaving and reopening, or after Save Changes), not just once. This is
  // load/display behavior, not user-triggered regeneration: it always
  // re-resolves against the Collection's own stored algorithm/item-limit/
  // overrides (see resolveCollectionPreviewById in collectionsPreview.ts),
  // never persists the algorithm's base pool, and a Manual or Guide
  // Collection's algorithmKey is always null, so this never runs for them.
  const isAlgorithmic = collection.algorithmKey !== null;
  const resolution = isAlgorithmic ? await resolveCollectionPreviewById(id) : null;
  const resolvedResult = resolution?.success ? resolution.preview : null;
  const resolvedError = resolution && !resolution.success ? resolution.error : null;

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
        resolvedResult={resolvedResult}
        resolvedError={resolvedError}
      />
    </div>
  );
}
