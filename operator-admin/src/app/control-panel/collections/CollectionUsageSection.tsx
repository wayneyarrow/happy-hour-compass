import type { CollectionUsageSummary } from "@/lib/data/collectionsShared";

const SECTION_TYPE_LABELS: Record<string, string> = {
  venue: "Venue Section",
  event: "Event Section",
  guide: "Guide Section",
};

/**
 * Read-only Homepage usage display — see getCollectionUsage() in
 * collections.ts. Informational only; the DB's ON DELETE RESTRICT on
 * homepage_sections remains the authoritative deletion backstop (Homepage
 * Management itself is out of scope for this task).
 *
 * Never gates Publishing and never offers Homepage assignment controls here
 * — a Collection may be Published with zero Homepage usages; assignment is
 * exclusively a future Homepage Management concern (see product spec).
 */
export default function CollectionUsageSection({ usage }: { usage: CollectionUsageSummary }) {
  return (
    <div className="space-y-3">
      {usage.entries.length === 0 ? (
        <p className="text-sm text-gray-400">This Collection is not currently used by any Homepage.</p>
      ) : (
        <div className="space-y-2">
          {usage.isUsedByPublishedHomepage && (
            <p className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
              This Collection is live on at least one Published Homepage — changes here take effect immediately there.
            </p>
          )}
          <ul className="space-y-2">
            {usage.entries.map((entry) => (
              <li
                key={entry.sectionId}
                className="flex items-center justify-between gap-3 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium text-slate-800">{entry.sectionTitle}</span>
                  <span className="text-gray-400"> · {SECTION_TYPE_LABELS[entry.sectionType] ?? entry.sectionType}</span>
                  <div className="text-xs text-gray-400">
                    {entry.homepageName || (entry.homepageCityName ?? entry.homepageMarketName)}
                    {entry.homepageCityName ? ` · ${entry.homepageMarketName}` : ""}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                    entry.homepageStatus === "published" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {entry.homepageStatus === "published" ? "Published" : "Draft"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-gray-400">
        Collections are assigned to Homepage Sections from Homepage Management, not from here. A Collection
        does not need to be assigned to any Homepage before it can be Published.
      </p>
    </div>
  );
}
