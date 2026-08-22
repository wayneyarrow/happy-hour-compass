"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination } from "@/components/TableControls";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { formatDate as fmtDate } from "@/lib/controlPanelDateTime";
import type { UnpublishedVenueRow } from "@/lib/data/actionCenter";

type SortCol =
  | "name" | "city" | "plan" | "setupHealthScorePct"
  | "operatorLastSeenAt" | "updatedAt" | "venueViews30d" | "eventViews30d";

const PAGE_SIZE    = 25;
const DEFAULT_SORT: SortCol = "setupHealthScorePct";

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

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

const PLAN_COLORS: Record<string, string> = {
  free: "bg-gray-100 text-gray-600", pro: "bg-blue-100 text-blue-700",
  premium: "bg-purple-100 text-purple-700", enterprise: "bg-indigo-100 text-indigo-700",
};

function PlanBadge({ plan }: { plan: string | null }) {
  if (!plan) return <span className="text-gray-300 text-xs">—</span>;
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${PLAN_COLORS[plan] ?? "bg-gray-100 text-gray-600"}`}>{plan}</span>;
}

function HealthBadge({ pct }: { pct: number }) {
  const cls = pct >= 90 ? "bg-green-100 text-green-700" : pct >= 60 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700";
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{pct}%</span>;
}

export default function UnpublishedVenuesTable({ rows }: { rows: UnpublishedVenueRow[] }) {
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
        case "name":               cmp = a.name.localeCompare(b.name); break;
        case "city":               cmp = (a.city ?? "").localeCompare(b.city ?? ""); break;
        case "plan":               cmp = (a.plan ?? "").localeCompare(b.plan ?? ""); break;
        case "setupHealthScorePct": cmp = a.setupHealthScorePct - b.setupHealthScorePct; break;
        case "operatorLastSeenAt": cmp = (a.operatorLastSeenAt ?? "").localeCompare(b.operatorLastSeenAt ?? ""); break;
        case "updatedAt":          cmp = a.updatedAt.localeCompare(b.updatedAt); break;
        case "venueViews30d":      cmp = a.venueViews30d - b.venueViews30d; break;
        case "eventViews30d":      cmp = a.eventViews30d - b.eventViews30d; break;
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
    const headers = ["Venue", "City", "Plan", "Health Score %", "Missing Setup Items", "Last Login", "Days Since Last Login", "Last Updated", "Venue Views (30d)", "Event Views (30d)"];
    const csvRows = sorted.map((r) => {
      const dsl = daysSince(r.operatorLastSeenAt);
      return [
        r.name, r.city, r.plan ?? "",
        String(r.setupHealthScorePct), r.missingItems.join("; "),
        fmtDate(r.operatorLastSeenAt),
        dsl != null ? String(dsl) : "",
        fmtDate(r.updatedAt),
        String(r.venueViews30d), String(r.eventViews30d),
      ];
    });
    downloadCsv(`unpublished-venues-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, csvRows));
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
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("plan")} className={TH}>Plan <SortIcon active={sortCol === "plan"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("setupHealthScorePct")} className={TH}>Health <SortIcon active={sortCol === "setupHealthScorePct"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Missing Setup</span></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("operatorLastSeenAt")} className={TH}>Last Login <SortIcon active={sortCol === "operatorLastSeenAt"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("updatedAt")} className={TH}>Last Updated <SortIcon active={sortCol === "updatedAt"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("venueViews30d")} className={TH}>Venue Views (30d) <SortIcon active={sortCol === "venueViews30d"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("eventViews30d")} className={TH}>Event Views (30d) <SortIcon active={sortCol === "eventViews30d"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>View</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map((r) => {
                    const dsl = daysSince(r.operatorLastSeenAt);
                    return (
                      <tr key={r.id} onClick={() => router.push(`/control-panel/venues/${r.id}`)}
                        className="hover:bg-amber-50 transition-colors cursor-pointer">
                        <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                        <td className="px-4 py-3 text-gray-600">{r.city ?? <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-3"><PlanBadge plan={r.plan} /></td>
                        <td className="px-4 py-3"><HealthBadge pct={r.setupHealthScorePct} /></td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[160px]">
                          {r.missingItems.length === 0
                            ? <span className="text-green-600 font-medium">Complete</span>
                            : r.missingItems.join(", ")}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                          {r.operatorLastSeenAt
                            ? <>{fmtDate(r.operatorLastSeenAt)}{dsl != null && <span className="text-gray-400 ml-1">({dsl}d ago)</span>}</>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{fmtDate(r.updatedAt)}</td>
                        <td className="px-4 py-3 text-gray-600 tabular-nums">{r.venueViews30d.toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-600 tabular-nums">{r.eventViews30d.toLocaleString()}</td>
                        <td className="px-4 py-3"><span className="text-xs font-medium text-amber-600">View →</span></td>
                      </tr>
                    );
                  })}
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
