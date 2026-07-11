import type { CollectionUsageSummary } from "@/lib/data/collectionsShared";

const SECTION_TYPE_LABELS: Record<string, string> = {
  venue: "Venue Section",
  event: "Event Section",
  guide: "Guide Section",
};

/**
 * Compact right-rail "Homepage Usage" card (see CollectionForm.tsx's
 * two-column layout) — self-contained (owns its own card chrome + title)
 * rather than relying on a parent <section> wrapper, since it now sits
 * alongside CollectionChecklist in the sticky rail instead of as a
 * full-width section in the main column.
 *
 * Reuses getCollectionUsage() (collections.ts) as-is — no relationship
 * logic is rebuilt here, only the presentation shrinks to fit a narrow card.
 *
 * "Links to the relevant homepage editor where practical" (product ask):
 * there is no Homepage Management admin UI yet (see CLAUDE.md "Current
 * status and next steps" — database foundation and data layer only), so
 * there is no real route to link to. Entries are shown as plain text rather
 * than guessed/broken links; add real links here once that editor exists.
 *
 * Never gates Publishing and never offers Homepage assignment controls here
 * — a Collection may be Published with zero Homepage usages; assignment is
 * exclusively a future Homepage Management concern (see product spec).
 */
export default function CollectionUsageSection({ usage }: { usage: CollectionUsageSummary }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">Homepage Usage</h2>

      {usage.entries.length === 0 ? (
        <p className="text-xs text-gray-400">Not used on a homepage.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Used by {usage.entries.length} homepage section{usage.entries.length === 1 ? "" : "s"}.
          </p>
          {usage.isUsedByPublishedHomepage && (
            <p className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5">
              Live on at least one Published Homepage.
            </p>
          )}
          <ul className="space-y-2">
            {usage.entries.map((entry) => (
              <li
                key={entry.sectionId}
                className="flex items-start justify-between gap-2 flex-wrap px-2.5 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs"
              >
                <div className="min-w-0">
                  <span className="font-medium text-slate-800 block truncate">{entry.sectionTitle}</span>
                  <span className="text-gray-400 block truncate">{SECTION_TYPE_LABELS[entry.sectionType] ?? entry.sectionType}</span>
                  <span className="text-gray-400 block truncate">
                    {entry.homepageName || (entry.homepageCityName ?? entry.homepageMarketName)}
                  </span>
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
        Assigned from Homepage Management, not from here. Publishing doesn&apos;t require homepage assignment.
      </p>
    </div>
  );
}
