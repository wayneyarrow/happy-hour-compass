"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination } from "@/components/TableControls";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import type { VerifiedWithoutOperatorRow } from "@/lib/data/actionCenter";

type SortCol = "name" | "city" | "source" | "venueViews30d" | "eventViews30d" | "isPublished";

const PAGE_SIZE    = 25;
const DEFAULT_SORT: SortCol = "venueViews30d";

function readUrlParam(key: string, fb: string): string {
  return new URLSearchParams(window.location.search).get(key) ?? fb;
}

function syncUrl(q: string, sort: string, dir: string, page: number) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (sort !== DEFAULT_SORT) p.set("sort", sort);
  if (dir !== "desc") p.set("dir", dir);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

export default function VerifiedNoOperatorTable({ rows }: { rows: VerifiedWithoutOperatorRow[] }) {
  const router = useRouter();

  const [q,       setQ]       = useState("");
  const [sortCol, setSortCol] = useState<SortCol>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page,    setPage]    = useState(1);

  useEffect(() => {
    setQ(readUrlParam("q", ""));
    setSortCol(readUrlParam("sort", DEFAULT_SORT) as SortCol);
    setSortDir(readUrlParam("dir", "desc") as "asc" | "desc");
    setPage(Math.max(1, parseInt(readUrlParam("page", "1"), 10)));
  }, []);

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return rows.filter((r) => !lq || r.name.toLowerCase().includes(lq) || (r.city?.toLowerCase().includes(lq) ?? false));
  }, [rows, q]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":          cmp = a.name.localeCompare(b.name); break;
        case "city":          cmp = (a.city ?? "").localeCompare(b.city ?? ""); break;
        case "source":        cmp = (a.source ?? "").localeCompare(b.source ?? ""); break;
        case "venueViews30d": cmp = a.venueViews30d - b.venueViews30d; break;
        case "eventViews30d": cmp = a.eventViews30d - b.eventViews30d; break;
        case "isPublished":   cmp = Number(a.isPublished) - Number(b.isPublished); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const applySort = (col: SortCol) => {
    const dir = col === sortCol && sortDir === "desc" ? "asc" : "desc";
    setSortCol(col); setSortDir(dir); setPage(1); syncUrl(q, col, dir, 1);
  };
  const applySearch = (val: string) => { setQ(val); setPage(1); syncUrl(val, sortCol, sortDir, 1); };
  const applyPage   = (p: number)   => { setPage(p); syncUrl(q, sortCol, sortDir, p); };

  const handleExport = () => {
    const headers = ["Venue", "City", "Source", "Venue Views (30d)", "Event Views (30d)", "Published"];
    const csvRows = sorted.map((r) => [
      r.name, r.city, r.source ?? "",
      String(r.venueViews30d), String(r.eventViews30d),
      r.isPublished ? "Yes" : "No",
    ]);
    downloadCsv(`verified-no-operator-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, csvRows));
  };

  const TH  = "group inline-flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors whitespace-nowrap";
  const THS = "text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={q} onChange={(e) => applySearch(e.target.value)}
          placeholder="Search venues or city…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <span className="ml-auto text-sm text-gray-400">{filtered.length} of {rows.length}</span>
        <button type="button" onClick={handleExport} disabled={sorted.length === 0}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
          Export CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No venues match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-slate-50">
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("name")} className={TH}>Venue <SortIcon active={sortCol === "name"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("city")} className={TH}>City <SortIcon active={sortCol === "city"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("source")} className={TH}>Source <SortIcon active={sortCol === "source"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("venueViews30d")} className={TH}>Venue Views (30d) <SortIcon active={sortCol === "venueViews30d"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("eventViews30d")} className={TH}>Event Views (30d) <SortIcon active={sortCol === "eventViews30d"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("isPublished")} className={TH}>Published <SortIcon active={sortCol === "isPublished"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>View</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/control-panel/venues/${r.id}`)}
                      className="hover:bg-amber-50 transition-colors cursor-pointer">
                      <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                      <td className="px-4 py-3 text-gray-600">{r.city ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs capitalize">{r.source ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">{r.venueViews30d.toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">{r.eventViews30d.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        {r.isPublished
                          ? <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Published</span>
                          : <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">Draft</span>}
                      </td>
                      <td className="px-4 py-3"><span className="text-xs font-medium text-amber-600">View →</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={safePage} totalPages={totalPages} onPage={applyPage} />
        </>
      )}
    </div>
  );
}
