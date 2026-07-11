"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination } from "@/components/TableControls";
import StatusBadge from "@/components/StatusBadge";
import type { MarketRecord, CityRecord } from "@/lib/geo/types";
import type { HomepageSummary, HomepageStatus } from "@/lib/data/homepages";

type SortCol = "name" | "status" | "updatedAt";
type StatusFilter = "all" | HomepageStatus;

const PAGE_SIZE = 25;
const DEFAULT_SORT: SortCol = "updatedAt";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function readUrlParam(key: string, fallback: string): string {
  const p = new URLSearchParams(window.location.search);
  return p.get(key) ?? fallback;
}

function syncUrl(q: string, status: string, marketId: string, cityId: string, sort: string, dir: string, page: number) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (status !== "all") p.set("status", status);
  if (marketId) p.set("market", marketId);
  if (cityId) p.set("city", cityId);
  if (sort !== DEFAULT_SORT) p.set("sort", sort);
  if (dir !== "desc") p.set("dir", dir);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

export default function HomepagesTable({
  rows,
  markets,
  cities,
}: {
  rows: HomepageSummary[];
  markets: MarketRecord[];
  cities: CityRecord[];
}) {
  const router = useRouter();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [marketId, setMarketId] = useState("");
  const [cityId, setCityId] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setQ(readUrlParam("q", ""));
    setStatus(readUrlParam("status", "all") as StatusFilter);
    setMarketId(readUrlParam("market", ""));
    setCityId(readUrlParam("city", ""));
    setSortCol(readUrlParam("sort", DEFAULT_SORT) as SortCol);
    setSortDir(readUrlParam("dir", "desc") as "asc" | "desc");
    setPage(Math.max(1, parseInt(readUrlParam("page", "1"), 10)));
  }, []);

  const citiesForMarket = useMemo(
    () => (marketId ? cities.filter((c) => c.marketId === marketId) : cities),
    [cities, marketId]
  );

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return rows.filter((h) => {
      if (lq && !h.name.toLowerCase().includes(lq)) return false;
      if (status !== "all" && h.status !== status) return false;
      if (marketId && h.marketId !== marketId) return false;
      if (cityId && h.cityId !== cityId) return false;
      return true;
    });
  }, [rows, q, status, marketId, cityId]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "updatedAt":
          cmp = a.updatedAt.localeCompare(b.updatedAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const applySort = (col: SortCol) => {
    const newDir = col === sortCol && sortDir === "desc" ? "asc" : "desc";
    setSortCol(col);
    setSortDir(newDir);
    setPage(1);
    syncUrl(q, status, marketId, cityId, col, newDir, 1);
  };

  const applySearch = (val: string) => {
    setQ(val);
    setPage(1);
    syncUrl(val, status, marketId, cityId, sortCol, sortDir, 1);
  };

  const applyStatus = (val: StatusFilter) => {
    setStatus(val);
    setPage(1);
    syncUrl(q, val, marketId, cityId, sortCol, sortDir, 1);
  };

  const applyMarket = (val: string) => {
    setMarketId(val);
    const stillValid = cities.some((c) => c.id === cityId && c.marketId === val);
    const nextCity = stillValid ? cityId : "";
    setCityId(nextCity);
    setPage(1);
    syncUrl(q, status, val, nextCity, sortCol, sortDir, 1);
  };

  const applyCity = (val: string) => {
    setCityId(val);
    setPage(1);
    syncUrl(q, status, marketId, val, sortCol, sortDir, 1);
  };

  const applyPage = (p: number) => {
    setPage(p);
    syncUrl(q, status, marketId, cityId, sortCol, sortDir, p);
  };

  const selectCls =
    "text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white " +
    "text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-gray-50 disabled:text-gray-400";

  const thBtnCls =
    "group inline-flex items-center text-xs font-semibold text-gray-500 " +
    "uppercase tracking-wide hover:text-gray-700 transition-colors whitespace-nowrap";

  const thStaticCls = "text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => applySearch(e.target.value)}
          placeholder="Search Homepages…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <select value={status} onChange={(e) => applyStatus(e.target.value as StatusFilter)} className={selectCls}>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        <select value={marketId} onChange={(e) => applyMarket(e.target.value)} className={selectCls}>
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select
          value={cityId}
          onChange={(e) => applyCity(e.target.value)}
          disabled={citiesForMarket.length === 0}
          className={selectCls}
        >
          <option value="">All cities</option>
          {citiesForMarket.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span className="ml-auto text-sm text-gray-400">
          {filtered.length} of {rows.length} Homepages
        </span>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No Homepages match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("name")} className={thBtnCls}>
                      Homepage <SortIcon active={sortCol === "name"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Geography</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("status")} className={thBtnCls}>
                      Status <SortIcon active={sortCol === "status"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("updatedAt")} className={thBtnCls}>
                      Updated <SortIcon active={sortCol === "updatedAt"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageRows.map((h) => (
                  <tr
                    key={h.id}
                    onClick={() => router.push(`/control-panel/homepages/${h.id}/edit`)}
                    className="cursor-pointer transition-colors hover:bg-amber-50"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap max-w-xs">
                      <div className="truncate">{h.name}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {h.cityName ? (
                        <>
                          {h.cityName} <span className="text-gray-300">·</span>{" "}
                          <span className="text-gray-400">{h.marketName}</span>
                        </>
                      ) : (
                        <>
                          {h.marketName} <span className="ml-1.5 text-xs text-gray-400">(Market Homepage)</span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge
                        variant={h.status === "published" ? "success" : "neutral"}
                        label={h.status === "published" ? "Published" : "Draft"}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(h.updatedAt)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className="text-xs font-medium text-amber-600 hover:text-amber-700">Edit →</span>
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
