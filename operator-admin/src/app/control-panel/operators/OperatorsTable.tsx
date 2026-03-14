"use client";

import { useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export type OperatorRow = {
  id: string;
  name: string | null;
  email: string;
  is_approved: boolean;
  venueName: string | null;
  venueSlug: string | null;
  created_at: string; // pre-formatted
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function ApprovedBadge({ approved }: { approved: boolean }) {
  return approved ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
      Approved
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
      Pending
    </span>
  );
}

// ── OperatorsTable ─────────────────────────────────────────────────────────────

export default function OperatorsTable({ rows }: { rows: OperatorRow[] }) {
  const [operatorSearch, setOperatorSearch] = useState("");
  const [venueSearch,    setVenueSearch]    = useState("");

  // ── Client-side filtering ──────────────────────────────────────────────────

  const filtered = rows.filter((op) => {
    if (operatorSearch) {
      const q = operatorSearch.toLowerCase();
      const nameMatch  = op.name?.toLowerCase().includes(q) ?? false;
      const emailMatch = op.email.toLowerCase().includes(q);
      if (!nameMatch && !emailMatch) return false;
    }
    if (venueSearch) {
      const q = venueSearch.toLowerCase();
      if (!op.venueName?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={operatorSearch}
          onChange={(e) => setOperatorSearch(e.target.value)}
          placeholder="Search by name or email…"
          className={
            "text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-56 " +
            "focus:outline-none focus:ring-2 focus:ring-amber-400"
          }
        />
        <input
          type="search"
          value={venueSearch}
          onChange={(e) => setVenueSearch(e.target.value)}
          placeholder="Search by venue…"
          className={
            "text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-48 " +
            "focus:outline-none focus:ring-2 focus:ring-amber-400"
          }
        />
        <span className="ml-auto text-sm text-gray-400">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No operators match the current filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Operator
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Email
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Venue
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((op) => (
                  <tr key={op.id} className="hover:bg-amber-50 transition-colors">
                    {/* Operator name */}
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {op.name ?? <span className="text-gray-300">—</span>}
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3 text-gray-600">{op.email}</td>

                    {/* Approval status */}
                    <td className="px-4 py-3">
                      <ApprovedBadge approved={op.is_approved} />
                    </td>

                    {/* Venue name + slug */}
                    <td className="px-4 py-3">
                      {op.venueName ? (
                        <>
                          {op.venueSlug ? (
                            <a
                              href={`/venue/${op.venueSlug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-slate-900 hover:text-amber-700 transition-colors"
                            >
                              {op.venueName}
                            </a>
                          ) : (
                            <span className="font-medium text-slate-900">{op.venueName}</span>
                          )}
                          {op.venueSlug && (
                            <div className="text-xs text-gray-400 mt-0.5 font-mono">
                              {op.venueSlug}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-300">No venue</span>
                      )}
                    </td>

                    {/* Created date */}
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {op.created_at}
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
