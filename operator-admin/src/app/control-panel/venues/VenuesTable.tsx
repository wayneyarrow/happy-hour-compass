"use client";

import { useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export type VenueRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  is_published: boolean;
  claimed_at: string | null;
  updated_at: string;
  operatorEmail: string | null;
};

type ClaimedFilter  = "all" | "claimed" | "unclaimed";
type PublishedFilter = "all" | "published" | "draft";

// ── Sub-components ─────────────────────────────────────────────────────────────

function PublishedBadge({ published }: { published: boolean }) {
  return published ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
      Published
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
      Draft
    </span>
  );
}

function ClaimedBadge({ claimedAt }: { claimedAt: string | null }) {
  return claimedAt ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
      Claimed
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
      Unclaimed
    </span>
  );
}

// ── VenuesTable ────────────────────────────────────────────────────────────────

export default function VenuesTable({ rows }: { rows: VenueRow[] }) {
  const [search,    setSearch]    = useState("");
  const [claimed,   setClaimed]   = useState<ClaimedFilter>("all");
  const [published, setPublished] = useState<PublishedFilter>("all");

  // ── Client-side filtering ──────────────────────────────────────────────────

  const filtered = rows.filter((v) => {
    if (search && !v.name.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    if (claimed === "claimed"   && !v.claimed_at)  return false;
    if (claimed === "unclaimed" &&  v.claimed_at)  return false;
    if (published === "published" && !v.is_published) return false;
    if (published === "draft"     &&  v.is_published) return false;
    return true;
  });

  // ── Shared select style ────────────────────────────────────────────────────

  const selectCls =
    "text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white " +
    "text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search venues…"
          className={
            "text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-56 " +
            "focus:outline-none focus:ring-2 focus:ring-amber-400"
          }
        />

        {/* Published filter */}
        <select
          value={published}
          onChange={(e) => setPublished(e.target.value as PublishedFilter)}
          className={selectCls}
        >
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>

        {/* Claimed filter */}
        <select
          value={claimed}
          onChange={(e) => setClaimed(e.target.value as ClaimedFilter)}
          className={selectCls}
        >
          <option value="all">All claim states</option>
          <option value="claimed">Claimed</option>
          <option value="unclaimed">Unclaimed</option>
        </select>

        {/* Result count */}
        <span className="ml-auto text-sm text-gray-400">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No venues match the current filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Venue
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    City
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Published
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Claimed
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Operator
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((v) => (
                  <tr key={v.id} className="hover:bg-amber-50 transition-colors">
                    {/* Venue name + slug */}
                    <td className="px-4 py-3">
                      <a
                        href={`/venue/${v.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-slate-900 hover:text-amber-700 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {v.name}
                      </a>
                      <div className="text-xs text-gray-400 mt-0.5 font-mono">
                        {v.slug}
                      </div>
                    </td>

                    {/* City */}
                    <td className="px-4 py-3 text-gray-600">
                      {v.city ?? <span className="text-gray-300">—</span>}
                    </td>

                    {/* Published badge */}
                    <td className="px-4 py-3">
                      <PublishedBadge published={v.is_published} />
                    </td>

                    {/* Claimed badge */}
                    <td className="px-4 py-3">
                      <ClaimedBadge claimedAt={v.claimed_at} />
                    </td>

                    {/* Operator email */}
                    <td className="px-4 py-3 text-gray-600">
                      {v.operatorEmail ?? (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>

                    {/* Updated date */}
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {v.updated_at}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
