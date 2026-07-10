"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination } from "@/components/TableControls";
import StatusBadge from "@/components/StatusBadge";
import type { MarketRecord, CityRecord } from "@/lib/geo/types";
import type { CollectionSummary, CollectionType, CollectionStatus } from "@/lib/data/collectionsShared";
import { RAIL_LABELS, type RailKey } from "@/lib/data/discoverOverridesShared";

// ── Types ──────────────────────────────────────────────────────────────────────

export type CollectionRow = CollectionSummary & {
  usageCount: number;
  isUsedByPublishedHomepage: boolean;
};

type SortCol = "name" | "collectionType" | "status" | "updatedAt";
type StatusFilter = "all" | CollectionStatus;
type TypeFilter = "all" | CollectionType;

const PAGE_SIZE = 25;
const DEFAULT_SORT: SortCol = "updatedAt";

const TYPE_LABELS: Record<CollectionType, string> = {
  venue: "Venue",
  event: "Event",
  guide: "Guide",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function algorithmLabel(key: CollectionRow["algorithmKey"]): string {
  if (!key) return "Manual";
  return RAIL_LABELS[key as RailKey] ?? key;
}

function readUrlParam(key: string, fallback: string): string {
  const p = new URLSearchParams(window.location.search);
  return p.get(key) ?? fallback;
}

function syncUrl(
  q: string, status: string, type: string, marketId: string, cityId: string,
  sort: string, dir: string, page: number
) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (status !== "all") p.set("status", status);
  if (type !== "all") p.set("type", type);
  if (marketId) p.set("market", marketId);
  if (cityId) p.set("city", cityId);
  if (sort !== DEFAULT_SORT) p.set("sort", sort);
  if (dir !== "desc") p.set("dir", dir);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

// ── CollectionsTable ───────────────────────────────────────────────────────────

export default function CollectionsTable({
  rows,
  markets,
  cities,
}: {
  rows: CollectionRow[];
  markets: MarketRecord[];
  cities: CityRecord[];
}) {
  const router = useRouter();

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [marketId, setMarketId] = useState("");
  const [cityId, setCityId] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setQ(readUrlParam("q", ""));
    setStatus(readUrlParam("status", "all") as StatusFilter);
    setType(readUrlParam("type", "all") as TypeFilter);
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

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return rows.filter((c) => {
      if (
        lq &&
        !c.name.toLowerCase().includes(lq) &&
        !(c.description ?? "").toLowerCase().includes(lq)
      ) {
        return false;
      }
      if (status !== "all" && c.status !== status) return false;
      if (type !== "all" && c.collectionType !== type) return false;
      if (marketId && c.marketId !== marketId) return false;
      if (cityId && c.cityId !== cityId) return false;
      return true;
    });
  }, [rows, q, status, type, marketId, cityId]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "collectionType":
          cmp = a.collectionType.localeCompare(b.collectionType);
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

  // ── State update helpers ──────────────────────────────────────────────────

  const applySort = (col: SortCol) => {
    const newDir = col === sortCol && sortDir === "desc" ? "asc" : "desc";
    setSortCol(col);
    setSortDir(newDir);
    setPage(1);
    syncUrl(q, status, type, marketId, cityId, col, newDir, 1);
  };

  const applySearch = (val: string) => {
    setQ(val);
    setPage(1);
    syncUrl(val, status, type, marketId, cityId, sortCol, sortDir, 1);
  };

  const applyStatus = (val: StatusFilter) => {
    setStatus(val);
    setPage(1);
    syncUrl(q, val, type, marketId, cityId, sortCol, sortDir, 1);
  };

  const applyType = (val: TypeFilter) => {
    setType(val);
    setPage(1);
    syncUrl(q, status, val, marketId, cityId, sortCol, sortDir, 1);
  };

  const applyMarket = (val: string) => {
    setMarketId(val);
    // Changing market clears an incompatible selected city, same rule as the editor forms.
    const stillValid = cities.some((c) => c.id === cityId && c.marketId === val);
    const nextCity = stillValid ? cityId : "";
    setCityId(nextCity);
    setPage(1);
    syncUrl(q, status, type, val, nextCity, sortCol, sortDir, 1);
  };

  const applyCity = (val: string) => {
    setCityId(val);
    setPage(1);
    syncUrl(q, status, type, marketId, val, sortCol, sortDir, 1);
  };

  const applyPage = (p: number) => {
    setPage(p);
    syncUrl(q, status, type, marketId, cityId, sortCol, sortDir, p);
  };

  // ── Shared styles ─────────────────────────────────────────────────────────

  const selectCls =
    "text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white " +
    "text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-gray-50 disabled:text-gray-400";

  const thBtnCls =
    "group inline-flex items-center text-xs font-semibold text-gray-500 " +
    "uppercase tracking-wide hover:text-gray-700 transition-colors whitespace-nowrap";

  const thStaticCls = "text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => applySearch(e.target.value)}
          placeholder="Search Collections…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <select value={status} onChange={(e) => applyStatus(e.target.value as StatusFilter)} className={selectCls}>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        <select value={type} onChange={(e) => applyType(e.target.value as TypeFilter)} className={selectCls}>
          <option value="all">All types</option>
          <option value="venue">Venue</option>
          <option value="event">Event</option>
          <option value="guide">Guide</option>
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
          {filtered.length} of {rows.length} Collections
        </span>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No Collections match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("name")} className={thBtnCls}>
                      Collection <SortIcon active={sortCol === "name"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("collectionType")} className={thBtnCls}>
                      Type <SortIcon active={sortCol === "collectionType"} dir={sortDir} />
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
                    <span className={thStaticCls}>Algorithm / Mode</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Usage</span>
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
                {pageRows.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/control-panel/collections/${c.id}/edit`)}
                    className="hover:bg-amber-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap max-w-xs">
                      <div className="truncate">{c.name}</div>
                      {c.description && (
                        <div className="text-xs text-gray-400 mt-0.5 truncate font-normal">{c.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{TYPE_LABELS[c.collectionType]}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {c.cityName ? (
                        <>
                          {c.cityName} <span className="text-gray-300">·</span>{" "}
                          <span className="text-gray-400">{c.marketName}</span>
                        </>
                      ) : (
                        c.marketName
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge
                        variant={c.status === "published" ? "success" : "neutral"}
                        label={c.status === "published" ? "Published" : "Draft"}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{algorithmLabel(c.algorithmKey)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.usageCount === 0 ? (
                        <span className="text-gray-300">Unused</span>
                      ) : (
                        <span className="text-gray-600">
                          {c.usageCount} section{c.usageCount === 1 ? "" : "s"}
                          {c.isUsedByPublishedHomepage && (
                            <span className="ml-1.5 text-xs font-medium text-emerald-600">● Live</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(c.updatedAt)}</td>
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
