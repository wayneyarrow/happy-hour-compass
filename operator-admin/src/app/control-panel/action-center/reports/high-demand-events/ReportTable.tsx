"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination } from "@/components/TableControls";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import type { HighDemandEventRow } from "@/lib/data/actionCenter";

type SortCol =
  | "eventTitle" | "venueName" | "city" | "plan"
  | "venueSetupHealthScorePct" | "eventViews30d" | "eventDate" | "isPublished";

const PAGE_SIZE    = 25;
const DEFAULT_SORT: SortCol = "eventViews30d";

// Intentionally NOT routed through src/lib/controlPanelDateTime's Pacific-time
// helpers. `eventDate` is `events.first_date`, a plain Postgres DATE with no
// time-of-day/instant meaning (unlike the TIMESTAMPTZ columns elsewhere in the
// Control Panel). Applying a timezone conversion to a bare calendar date can
// shift it to the wrong day, so this formats the stored Y-M-D literally.
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

export default function HighDemandEventsTable({ rows }: { rows: HighDemandEventRow[] }) {
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
    return rows.filter((r) =>
      !lq ||
      r.eventTitle.toLowerCase().includes(lq) ||
      r.venueName.toLowerCase().includes(lq) ||
      (r.city?.toLowerCase().includes(lq) ?? false)
    );
  }, [rows, q]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "eventTitle":            cmp = a.eventTitle.localeCompare(b.eventTitle); break;
        case "venueName":             cmp = a.venueName.localeCompare(b.venueName); break;
        case "city":                  cmp = (a.city ?? "").localeCompare(b.city ?? ""); break;
        case "plan":                  cmp = (a.plan ?? "").localeCompare(b.plan ?? ""); break;
        case "venueSetupHealthScorePct": cmp = a.venueSetupHealthScorePct - b.venueSetupHealthScorePct; break;
        case "eventViews30d":         cmp = a.eventViews30d - b.eventViews30d; break;
        case "eventDate":             cmp = (a.eventDate ?? "").localeCompare(b.eventDate ?? ""); break;
        case "isPublished":           cmp = Number(a.isPublished) - Number(b.isPublished); break;
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
    const headers = ["Event", "Venue", "City", "Plan", "Venue Health Score %", "Event Views (30d)", "Event Date", "Published"];
    const csvRows = sorted.map((r) => [
      r.eventTitle, r.venueName, r.city, r.plan ?? "",
      String(r.venueSetupHealthScorePct), String(r.eventViews30d),
      fmtDate(r.eventDate), r.isPublished ? "Yes" : "No",
    ]);
    downloadCsv(`high-demand-events-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, csvRows));
  };

  const TH  = "group inline-flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors whitespace-nowrap";
  const THS = "text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={q} onChange={(e) => applySearch(e.target.value)}
          placeholder="Search event, venue or city…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <span className="ml-auto text-sm text-gray-400">{filtered.length} of {rows.length}</span>
        <button type="button" onClick={handleExport} disabled={sorted.length === 0}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
          Export CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No events match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-slate-50">
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("eventTitle")} className={TH}>Event <SortIcon active={sortCol === "eventTitle"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("venueName")} className={TH}>Venue <SortIcon active={sortCol === "venueName"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("city")} className={TH}>City <SortIcon active={sortCol === "city"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("plan")} className={TH}>Plan <SortIcon active={sortCol === "plan"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("venueSetupHealthScorePct")} className={TH}>Venue Health <SortIcon active={sortCol === "venueSetupHealthScorePct"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("eventViews30d")} className={TH}>Event Views (30d) <SortIcon active={sortCol === "eventViews30d"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("eventDate")} className={TH}>Event Date <SortIcon active={sortCol === "eventDate"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("isPublished")} className={TH}>Published <SortIcon active={sortCol === "isPublished"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>View Venue</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map((r) => (
                    <tr key={r.eventId} onClick={() => router.push(`/control-panel/venues/${r.venueId}`)}
                      className="hover:bg-amber-50 transition-colors cursor-pointer">
                      <td className="px-4 py-3 font-medium text-slate-900 max-w-[200px]">
                        <span className="truncate block">{r.eventTitle}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{r.venueName}</td>
                      <td className="px-4 py-3 text-gray-600">{r.city ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3"><PlanBadge plan={r.plan} /></td>
                      <td className="px-4 py-3"><HealthBadge pct={r.venueSetupHealthScorePct} /></td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums font-medium">{r.eventViews30d.toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">{fmtDate(r.eventDate)}</td>
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
