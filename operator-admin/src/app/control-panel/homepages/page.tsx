export const dynamic = "force-dynamic";
export const metadata = { title: "Homepages" };

import Link from "next/link";
import { getHomepages, getHomepageFormGeography } from "@/lib/data/homepages";
import HomepagesTable from "./HomepagesTable";

export default async function HomepagesPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const [homepages, { markets, cities }, { success }] = await Promise.all([
    getHomepages(),
    getHomepageFormGeography(),
    searchParams,
  ]);

  const successMessage =
    success === "created" ? "Homepage created." : success === "updated" ? "Homepage saved." : null;

  return (
    <div className="max-w-7xl">
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Homepages</h1>
          <p className="mt-1 text-sm text-gray-500 max-w-2xl">
            One Homepage per geographic destination — a Market or a City within a Market. Homepages
            assemble published Collections via Sections; they never own content directly.
          </p>
        </div>
        <Link
          href="/control-panel/homepages/new"
          className="shrink-0 text-sm px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors whitespace-nowrap"
        >
          Create Homepage
        </Link>
      </div>

      {/* Success banner */}
      {successMessage && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-5 py-3 text-sm text-green-700">
          {successMessage}
        </div>
      )}

      {/* Empty state */}
      {homepages.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
              />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-slate-900 mb-1">No Homepages yet</h2>
          <p className="text-sm text-gray-500 max-w-xs mx-auto mb-4">
            Create your first Homepage to assemble Collections for a Market or City.
          </p>
          <Link
            href="/control-panel/homepages/new"
            className="inline-block text-sm px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors"
          >
            Create Homepage
          </Link>
        </div>
      )}

      {/* Homepages table */}
      {homepages.length > 0 && <HomepagesTable rows={homepages} markets={markets} cities={cities} />}
    </div>
  );
}
