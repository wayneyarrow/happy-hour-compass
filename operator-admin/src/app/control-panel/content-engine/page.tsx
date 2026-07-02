export const dynamic = "force-dynamic";
export const metadata = { title: "Content Engine" };

import Link from "next/link";
import { getContentGuides, type GuideStatus, type GuideType } from "@/lib/data/contentGuides";
import StatusBadge, { type StatusVariant } from "@/components/StatusBadge";

// ── Display maps ─────────────────────────────────────────────────────────────

const GUIDE_TYPE_LABELS: Record<GuideType, string> = {
  venue_guide: "Venue Guide",
  event_guide: "Event Guide",
};

// Card 7: status is binary (draft/published) — see contentGuides.ts's
// GuideStatus type and normalizeGuideStatus() for how legacy
// scheduled/expired rows are coerced on read.
const STATUS_VARIANT: Record<GuideStatus, StatusVariant> = {
  draft: "neutral",
  published: "success",
};

const STATUS_LABELS: Record<GuideStatus, string> = {
  draft: "Draft",
  published: "Published",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ContentEnginePage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const [guides, { success }] = await Promise.all([getContentGuides(), searchParams]);

  const thCls =
    "px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";

  const successMessage =
    success === "created" ? "Guide created." : success === "updated" ? "Guide saved." : null;

  return (
    <div className="max-w-7xl">
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Content Engine</h1>
          <p className="mt-1 text-sm text-gray-500 max-w-2xl">
            Create and manage the Venue Guides and Event Guides platform admins publish
            across the Happy Hour Compass website.
          </p>
        </div>
        <Link
          href="/control-panel/content-engine/new"
          className="shrink-0 text-sm px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors whitespace-nowrap"
        >
          Create Guide
        </Link>
      </div>

      {/* Success banner */}
      {successMessage && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-5 py-3 text-sm text-green-700">
          {successMessage}
        </div>
      )}

      {/* Empty state */}
      {guides.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
            <svg
              className="w-6 h-6 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
              />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-slate-900 mb-1">No guides yet</h2>
          <p className="text-sm text-gray-500 max-w-xs mx-auto">
            Venue Guides and Event Guides you publish will appear here.
          </p>
        </div>
      )}

      {/* Guides table */}
      {guides.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={thCls}>Title</th>
                <th scope="col" className={thCls}>Type</th>
                <th scope="col" className={thCls}>Status</th>
                <th scope="col" className={thCls}>Market</th>
                <th scope="col" className={thCls}>City</th>
                <th scope="col" className={thCls}>Publish Date</th>
                <th scope="col" className={thCls}>Updated</th>
                <th scope="col" className={thCls}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {guides.map((guide) => (
                <tr key={guide.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <Link
                      href={`/control-panel/content-engine/${guide.id}/edit`}
                      className="hover:text-amber-600 transition-colors"
                    >
                      {guide.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {GUIDE_TYPE_LABELS[guide.guide_type]}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusBadge
                      variant={STATUS_VARIANT[guide.status]}
                      label={STATUS_LABELS[guide.status]}
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {guide.marketName ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {guide.cityName ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {fmtDate(guide.publish_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {fmtDate(guide.updated_at)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link
                      href={`/control-panel/content-engine/${guide.id}/edit`}
                      className="text-xs font-medium text-amber-600 hover:text-amber-700"
                    >
                      Edit →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
