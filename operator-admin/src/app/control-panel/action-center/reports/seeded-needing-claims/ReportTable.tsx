"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination, CopyButton } from "@/components/TableControls";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import type { SeededNeedingClaimsRow } from "@/lib/data/actionCenter";

type SortCol =
  | "name" | "city" | "daysSinceSeeded" | "venueViews30d"
  | "eventViews30d" | "setupHealthScorePct" | "isPublished";
type PubFilter  = "all" | "published" | "unpublished";
type LiveFilter = "all" | "live" | "not-live";

const PAGE_SIZE    = 25;
const DEFAULT_SORT: SortCol = "venueViews30d";

function fmtNum(n: number): string { return n.toLocaleString(); }

function readUrlParam(key: string, fb: string): string {
  return new URLSearchParams(window.location.search).get(key) ?? fb;
}

function syncUrl(q: string, pub: string, live: string, sort: string, dir: string, page: number) {
  const p = new URLSearchParams();
  if (q)                   p.set("q",    q);
  if (pub !== "all")       p.set("pub",  pub);
  if (live !== "all")      p.set("live", live);
  if (sort !== DEFAULT_SORT) p.set("sort", sort);
  if (dir  !== "desc")     p.set("dir",  dir);
  if (page > 1)            p.set("page", String(page));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

function HealthBadge({ pct }: { pct: number }) {
  const cls =
    pct >= 90 ? "bg-green-100 text-green-700" :
    pct >= 60 ? "bg-yellow-100 text-yellow-700" :
                "bg-red-100 text-red-700";
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{pct}%</span>;
}

function PublishedBadge({ published }: { published: boolean }) {
  return published ? (
    <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Published</span>
  ) : (
    <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">Draft</span>
  );
}

export default function SeededNeedingClaimsTable({ rows }: { rows: SeededNeedingClaimsRow[] }) {
  const router = useRouter();

  const [q,       setQ]       = useState("");
  const [pub,     setPub]     = useState<PubFilter>("all");
  const [live,    setLive]    = useState<LiveFilter>("all");
  const [sortCol, setSortCol] = useState<SortCol>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page,    setPage]    = useState(1);

  useEffect(() => {
    setQ(readUrlParam("q", ""));
    setPub(readUrlParam("pub", "all") as PubFilter);
    setLive(readUrlParam("live", "all") as LiveFilter);
    setSortCol(readUrlParam("sort", DEFAULT_SORT) as SortCol);
    setSortDir(readUrlParam("dir",  "desc") as "asc" | "desc");
    setPage(Math.max(1, parseInt(readUrlParam("page", "1"), 10)));
  }, []);

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return rows.filter((r) => {
      if (lq && !r.name.toLowerCase().includes(lq) && !(r.city?.toLowerCase().includes(lq) ?? false)) return false;
      if (pub === "published"   && !r.isPublished) return false;
      if (pub === "unpublished" &&  r.isPublished) return false;
      if (live === "live"     && !r.isLiveOnSite) return false;
      if (live === "not-live" &&  r.isLiveOnSite) return false;
      return true;
    });
  }, [rows, q, pub, live]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":               cmp = a.name.localeCompare(b.name); break;
        case "city":               cmp = (a.city ?? "").localeCompare(b.city ?? ""); break;
        case "daysSinceSeeded":    cmp = a.daysSinceSeeded - b.daysSinceSeeded; break;
        case "venueViews30d":      cmp = a.venueViews30d - b.venueViews30d; break;
        case "eventViews30d":      cmp = a.eventViews30d - b.eventViews30d; break;
        case "setupHealthScorePct": cmp = a.setupHealthScorePct - b.setupHealthScorePct; break;
        case "isPublished":        cmp = Number(a.isPublished) - Number(b.isPublished); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const applySort = (col: SortCol) => {
    const dir = col === sortCol && sortDir === "desc" ? "asc" : "desc";
    setSortCol(col); setSortDir(dir); setPage(1);
    syncUrl(q, pub, live, col, dir, 1);
  };
  const applySearch = (val: string) => { setQ(val); setPage(1); syncUrl(val, pub, live, sortCol, sortDir, 1); };
  const applyPub    = (val: PubFilter)  => { setPub(val);  setPage(1); syncUrl(q, val, live, sortCol, sortDir, 1); };
  const applyLive   = (val: LiveFilter) => { setLive(val); setPage(1); syncUrl(q, pub, val, sortCol, sortDir, 1); };
  const applyPage   = (p: number)   => { setPage(p); syncUrl(q, pub, live, sortCol, sortDir, p); };

  const handleExport = () => {
    // Claimed/unclaimed scope is unchanged — this exports the rows already
    // loaded by getSeededNeedingClaims() (seeded + no operator attached),
    // narrowed by the active search, Status filter, and Live on site filter,
    // same as the table above. CRM contact fields are appended for outreach
    // use; they're display-only and never affect which venues appear here.
    const headers = [
      "Venue", "City", "Address", "Days Since Seeded", "Venue Views (30d)", "Event Views (30d)",
      "Health Score %", "Missing Setup Items", "Published", "Live on Site", "Source",
      "Contact Name", "Contact Role", "Contact Email", "Contact Phone", "Outreach Status",
    ];
    const csvRows = sorted.map((r) => [
      r.name, r.city, r.addressLine1, String(r.daysSinceSeeded),
      String(r.venueViews30d), String(r.eventViews30d),
      String(r.setupHealthScorePct), r.missingItems.join("; "),
      r.isPublished ? "Yes" : "No", r.isLiveOnSite ? "Yes" : "No", r.source,
      r.primaryContactName, r.primaryContactRole, r.primaryContactEmail, r.primaryContactPhone,
      r.primaryContactOutreachStatus,
    ]);
    downloadCsv(`seeded-needing-claims-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, csvRows));
  };

  const TH = "group inline-flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors whitespace-nowrap";
  const THS = "text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";
  const selectCls =
    "text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white " +
    "text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400";

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search" value={q} onChange={(e) => applySearch(e.target.value)}
          placeholder="Search venues or city…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <label className="flex items-center gap-2 text-sm text-gray-500">
          Status
          <select
            value={pub}
            onChange={(e) => applyPub(e.target.value as PubFilter)}
            className={selectCls}
          >
            <option value="all">All</option>
            <option value="published">Published</option>
            <option value="unpublished">Unpublished</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-500">
          Live on site
          <select
            value={live}
            onChange={(e) => applyLive(e.target.value as LiveFilter)}
            className={selectCls}
          >
            <option value="all">All</option>
            <option value="live">Live</option>
            <option value="not-live">Not live</option>
          </select>
        </label>
        <span className="ml-auto text-sm text-gray-400">{filtered.length} of {rows.length}</span>
        <button type="button" onClick={handleExport} disabled={sorted.length === 0}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
          Export CSV
        </button>
      </div>

      {/* Empty state */}
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
                    <th className="text-left px-4 py-3"><span className={THS}>Address</span></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("daysSinceSeeded")} className={TH}>Days Seeded <SortIcon active={sortCol === "daysSinceSeeded"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("venueViews30d")} className={TH}>Venue Views (30d) <SortIcon active={sortCol === "venueViews30d"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("eventViews30d")} className={TH}>Event Views (30d) <SortIcon active={sortCol === "eventViews30d"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("setupHealthScorePct")} className={TH}>Health <SortIcon active={sortCol === "setupHealthScorePct"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Missing Setup</span></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("isPublished")} className={TH}>Published <SortIcon active={sortCol === "isPublished"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Source</span></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Contact</span></th>
                    <th className="text-left px-4 py-3"><span className={THS}>View</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map((r) => (
                    <tr key={r.id} onClick={() => router.push(`/control-panel/venues/${r.id}`)}
                      className="hover:bg-amber-50 transition-colors cursor-pointer">
                      <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                      <td className="px-4 py-3 text-gray-600">{r.city ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">{r.addressLine1 ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">{r.daysSinceSeeded}d</td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">{fmtNum(r.venueViews30d)}</td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">{fmtNum(r.eventViews30d)}</td>
                      <td className="px-4 py-3"><HealthBadge pct={r.setupHealthScorePct} /></td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-[160px]">
                        {r.missingItems.length === 0
                          ? <span className="text-green-600 font-medium">Complete</span>
                          : r.missingItems.join(", ")}
                      </td>
                      <td className="px-4 py-3"><PublishedBadge published={r.isPublished} /></td>
                      <td className="px-4 py-3 text-gray-500 text-xs capitalize">{r.source ?? "—"}</td>
                      <td className="px-4 py-3 text-xs max-w-[180px]">
                        {r.primaryContactEmail ? (
                          <div className="truncate">
                            {r.primaryContactName && (
                              <div className="text-gray-700 font-medium truncate">{r.primaryContactName}</div>
                            )}
                            <div className="text-gray-500 inline-flex items-center gap-1 max-w-full">
                              <span className="truncate">{r.primaryContactEmail}</span>
                              <CopyButton value={r.primaryContactEmail} />
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
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
