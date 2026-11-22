"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination, CopyButton } from "@/components/TableControls";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import StatusBadge from "@/components/StatusBadge";
import { formatDate as fmtDate } from "@/lib/controlPanelDateTime";
import MarketFilterSelect from "@/components/MarketFilterSelect";
import { parseMarketFilter, type MarketFilterOption, type MarketFilterSelection } from "@/lib/marketFilter";
import {
  DEFAULT_VENUES_TABLE_STATE,
  deriveVenuesView,
  nextSort,
  nextVenuesState,
  parseVenuesUrlState,
  venueMarketLabel,
  venuesUrlSearch,
  type ClaimFilter,
  type PubFilter,
  type SortCol,
  type VenueRow,
  type VenuesTableState,
  type VerifiedFilter,
} from "./venuesTableView";

export type { VenueRow } from "./venuesTableView";

function syncUrl(state: VenuesTableState) {
  const qs = venuesUrlSearch(state);
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

// ── VenuesTable ────────────────────────────────────────────────────────────────

export default function VenuesTable({
  rows,
  marketOptions,
}: {
  rows: VenueRow[];
  marketOptions: MarketFilterOption[];
}) {
  const router = useRouter();

  const [state, setState] = useState<VenuesTableState>(DEFAULT_VENUES_TABLE_STATE);
  const { q, pub, claimed, verified, market, sortCol, sortDir } = state;

  // Hydrate state from URL once on mount. An unknown ?market= value falls back
  // to All markets and is dropped from the URL so the address bar matches.
  useEffect(() => {
    const { state: initial, marketRejected } = parseVenuesUrlState(window.location.search, marketOptions);
    setState(initial);
    if (marketRejected) syncUrl(initial);
    // Hydrate once on mount only — marketOptions is fixed server data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const marketNameById = useMemo(
    () => new Map(marketOptions.map((o) => [o.id, o.name])),
    [marketOptions]
  );
  const marketLabel = (v: VenueRow) => venueMarketLabel(v, marketNameById);

  // ── Derived data (filter → sort → paginate) ───────────────────────────────

  const { filtered, sorted, pageRows, totalPages, safePage } = useMemo(
    () => deriveVenuesView(rows, state, marketNameById),
    [rows, state, marketNameById]
  );

  // ── State update helpers ──────────────────────────────────────────────────
  // Every change writes the full state to the URL; any filter, search or sort
  // change returns to page 1.

  const update = (change: Parameters<typeof nextVenuesState>[1]) => {
    const next = nextVenuesState(state, change);
    setState(next);
    syncUrl(next);
  };

  const applySort     = (col: SortCol) => update(nextSort(state, col));
  const applySearch   = (val: string) => update({ q: val });
  const applyPub      = (val: PubFilter) => update({ pub: val });
  const applyClaimed  = (val: ClaimFilter) => update({ claimed: val });
  const applyVerified = (val: VerifiedFilter) => update({ verified: val });
  const applyMarket   = (val: MarketFilterSelection) => update({ market: parseMarketFilter(val, marketOptions) });
  const applyPage     = (p: number) => update({ page: p });

  const handleExport = () => {
    const headers = ["Venue", "City", "Market", "Published", "Verified", "Claimed", "Operator", "Updated"];
    const csvRows = sorted.map((v) => [
      v.name,
      v.city,
      marketLabel(v) ?? "Unassigned",
      v.is_published ? "Yes" : "No",
      v.is_verified ? "Yes" : "No",
      v.claimed_at  ? "Yes" : "No",
      v.operatorEmail,
      fmtDate(v.updated_at),
    ]);
    downloadCsv(
      `venues-${new Date().toISOString().slice(0, 10)}.csv`,
      buildCsv(headers, csvRows)
    );
  };

  // ── Shared styles ─────────────────────────────────────────────────────────

  const selectCls =
    "text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white " +
    "text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400";

  const thBtnCls =
    "group inline-flex items-center text-xs font-semibold text-gray-500 " +
    "uppercase tracking-wide hover:text-gray-700 transition-colors whitespace-nowrap";

  const thStaticCls =
    "text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => applySearch(e.target.value)}
          placeholder="Search venues or operator…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <select
          value={pub}
          onChange={(e) => applyPub(e.target.value as PubFilter)}
          className={selectCls}
        >
          <option value="all">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <select
          value={claimed}
          onChange={(e) => applyClaimed(e.target.value as ClaimFilter)}
          className={selectCls}
        >
          <option value="all">All claim states</option>
          <option value="claimed">Claimed</option>
          <option value="unclaimed">Unclaimed</option>
        </select>
        <select
          value={verified}
          onChange={(e) => applyVerified(e.target.value as VerifiedFilter)}
          className={selectCls}
        >
          <option value="all">All verification states</option>
          <option value="verified">Verified</option>
          <option value="unverified">Unverified</option>
        </select>
        <MarketFilterSelect
          options={marketOptions}
          value={market}
          onChange={applyMarket}
          className={selectCls}
        />
        <span className="ml-auto text-sm text-gray-400">
          {filtered.length} of {rows.length} {rows.length === 1 ? "venue" : "venues"}
        </span>
        <button
          type="button"
          onClick={handleExport}
          disabled={sorted.length === 0}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          Export CSV
        </button>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No venues match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("name")} className={thBtnCls}>
                      Venue <SortIcon active={sortCol === "name"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("city")} className={thBtnCls}>
                      City <SortIcon active={sortCol === "city"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("market")} className={thBtnCls}>
                      Market <SortIcon active={sortCol === "market"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("is_published")} className={thBtnCls}>
                      Published <SortIcon active={sortCol === "is_published"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("is_verified")} className={thBtnCls}>
                      Verified <SortIcon active={sortCol === "is_verified"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("claimed_at")} className={thBtnCls}>
                      Claimed <SortIcon active={sortCol === "claimed_at"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Operator</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("updated_at")} className={thBtnCls}>
                      Updated <SortIcon active={sortCol === "updated_at"} dir={sortDir} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageRows.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => router.push(`/control-panel/venues/${v.id}`)}
                    className="hover:bg-amber-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                      {v.name}
                      <div className="text-xs text-gray-400 mt-0.5 font-mono font-normal">{v.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {v.city ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {marketLabel(v) ?? <span className="text-gray-400 italic">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge
                        variant={v.is_published ? "success" : "neutral"}
                        label={v.is_published ? "Published" : "Draft"}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge
                        variant={v.is_verified ? "success" : "neutral"}
                        label={v.is_verified ? "Verified" : "Unverified"}
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge
                        variant={v.claimed_at ? "success" : "warning"}
                        label={v.claimed_at ? "Claimed" : "Unclaimed"}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {v.operatorEmail ? (
                        <span className="inline-flex items-center gap-1.5">
                          {v.operatorEmail}
                          <CopyButton value={v.operatorEmail} />
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {fmtDate(v.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={safePage} totalPages={totalPages} onPage={applyPage} />
        </>
      )}
    </div>
  );
}
