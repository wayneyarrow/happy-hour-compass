export const dynamic = "force-dynamic";
export const metadata = { title: "Collections" };

import Link from "next/link";
import {
  getCollections,
  getCollectionFormGeography,
  getCollectionUsageCounts,
} from "@/lib/data/collections";
import CollectionsTable from "./CollectionsTable";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  // lifecycle: "all" — the client table (CollectionsTable.tsx) filters
  // Active/Archived/All itself, the same way it already filters status/type/
  // market/city entirely client-side. The server must hand over the full
  // row-set (including archived rows) for that filter to have anything to
  // narrow down to; getCollections()'s own default (active-only) is for
  // callers that DON'T offer a lifecycle toggle, which this page does.
  const [collections, { markets, cities }, usageCounts, { success }] = await Promise.all([
    getCollections({ lifecycle: "all" }),
    getCollectionFormGeography(),
    getCollectionUsageCounts(),
    searchParams,
  ]);

  const rows = collections.map((c) => {
    const usage = usageCounts.get(c.id);
    return {
      ...c,
      usageCount: usage?.sectionCount ?? 0,
      isUsedByPublishedHomepage: usage?.isUsedByPublishedHomepage ?? false,
    };
  });

  const successMessage =
    success === "created"
      ? "Collection created."
      : success === "updated"
        ? "Collection saved."
        : success === "archived"
          ? "Collection archived."
          : null;

  return (
    <div className="max-w-7xl">
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Collections</h1>
          <p className="mt-1 text-sm text-gray-500 max-w-2xl">
            Reusable editorial curation — Venue, Event, and Guide Collections that Homepage
            Sections assemble into the public website. Collections own membership and ordering;
            they don&apos;t own where they&apos;re displayed.
          </p>
        </div>
        <Link
          href="/control-panel/collections/new"
          className="shrink-0 text-sm px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors whitespace-nowrap"
        >
          Create Collection
        </Link>
      </div>

      {/* Success banner */}
      {successMessage && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-5 py-3 text-sm text-green-700">
          {successMessage}
        </div>
      )}

      {/* Empty state */}
      {rows.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z"
              />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-slate-900 mb-1">No Collections yet</h2>
          <p className="text-sm text-gray-500 max-w-xs mx-auto mb-4">
            Create your first Collection to start curating Venues, Events, or Guides for Homepage
            Sections.
          </p>
          <Link
            href="/control-panel/collections/new"
            className="inline-block text-sm px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors"
          >
            Create Collection
          </Link>
        </div>
      )}

      {/* Collections table */}
      {rows.length > 0 && <CollectionsTable rows={rows} markets={markets} cities={cities} />}
    </div>
  );
}
