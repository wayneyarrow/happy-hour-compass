"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination, CopyButton } from "@/components/TableControls";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { formatDate as fmtDate } from "@/lib/controlPanelDateTime";
// UPGRADE_OPPORTUNITY_TYPES/UpgradeOpportunityType come from @/lib/plans,
// not @/lib/data/actionCenter — that module imports createAdminClient()/
// next-headers, which breaks a Client Component if it's given a runtime
// (non-type-only) import. UpgradeOpportunityRow is a type-only import so it
// gets erased at compile time and never actually pulls actionCenter.ts's
// server-only code into this client bundle.
import { UPGRADE_OPPORTUNITY_TYPES, type UpgradeOpportunityType } from "@/lib/plans";
import type { UpgradeOpportunityRow } from "@/lib/data/actionCenter";

type SortCol =
  | "name" | "city" | "plan" | "setupHealthScorePct"
  | "venueViews30d" | "operatorLastSeenAt";
type OpportunityFilter = "all" | UpgradeOpportunityType;
type VerifiedFilter = "all" | "verified" | "unverified";

const PAGE_SIZE    = 25;
const DEFAULT_SORT: SortCol = "venueViews30d";

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function readUrlParam(key: string, fb: string): string {
  return new URLSearchParams(window.location.search).get(key) ?? fb;
}

function syncUrl(q: string, opportunity: string, verified: string, sort: string, dir: string, page: number) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (opportunity !== "all") p.set("opportunity", opportunity);
  if (verified !== "all") p.set("verified", verified);
  if (sort !== DEFAULT_SORT) p.set("sort", sort);
  if (dir !== "desc") p.set("dir", dir);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

const PLAN_COLORS: Record<string, string> = {
  free: "bg-gray-100 text-gray-600", pro: "bg-blue-100 text-blue-700",
};

function PlanBadge({ plan }: { plan: string }) {
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium capitalize ${PLAN_COLORS[plan] ?? "bg-gray-100 text-gray-600"}`}>{plan}</span>;
}

function HealthBadge({ pct }: { pct: number }) {
  const cls = pct >= 90 ? "bg-green-100 text-green-700" : pct >= 60 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700";
  return <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{pct}%</span>;
}

function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Verified</span>
  ) : (
    <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">Unverified</span>
  );
}

export default function UpgradeOpportunitiesTable({ rows }: { rows: UpgradeOpportunityRow[] }) {
  const router = useRouter();

  const [q,           setQ]           = useState("");
  const [opportunity, setOpportunity] = useState<OpportunityFilter>("all");
  const [verified,    setVerified]    = useState<VerifiedFilter>("all");
  const [sortCol,     setSortCol]     = useState<SortCol>(DEFAULT_SORT);
  const [sortDir,     setSortDir]     = useState<"asc" | "desc">("desc");
  const [page,        setPage]        = useState(1);

  useEffect(() => {
    setQ(readUrlParam("q", ""));
    setOpportunity(readUrlParam("opportunity", "all") as OpportunityFilter);
    // Default stays "all" so existing report behaviour doesn't silently
    // change for anyone with an old bookmarked/shared link.
    setVerified(readUrlParam("verified", "all") as VerifiedFilter);
    setSortCol(readUrlParam("sort", DEFAULT_SORT) as SortCol);
    setSortDir(readUrlParam("dir", "desc") as "asc" | "desc");
    setPage(Math.max(1, parseInt(readUrlParam("page", "1"), 10)));
  }, []);

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return rows.filter((r) => {
      if (lq && !r.name.toLowerCase().includes(lq) && !(r.city?.toLowerCase().includes(lq) ?? false)) return false;
      // A venue with multiple opportunities matches the filter whenever ANY
      // of its opportunities equals the selected type (Example: a venue
      // with both Images and Events appears under both filters, and under
      // "All Opportunities").
      if (opportunity !== "all" && !r.opportunities.includes(opportunity)) return false;
      if (verified === "verified"   && !r.isVerified) return false;
      if (verified === "unverified" &&  r.isVerified) return false;
      return true;
    });
  }, [rows, q, opportunity, verified]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":               cmp = a.name.localeCompare(b.name); break;
        case "city":               cmp = (a.city ?? "").localeCompare(b.city ?? ""); break;
        case "plan":               cmp = a.plan.localeCompare(b.plan); break;
        case "setupHealthScorePct": cmp = a.setupHealthScorePct - b.setupHealthScorePct; break;
        case "venueViews30d":      cmp = a.venueViews30d - b.venueViews30d; break;
        case "operatorLastSeenAt": cmp = (a.operatorLastSeenAt ?? "").localeCompare(b.operatorLastSeenAt ?? ""); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const applySort = (col: SortCol) => {
    const dir = col === sortCol && sortDir === "desc" ? "asc" : "desc";
    setSortCol(col); setSortDir(dir); setPage(1); syncUrl(q, opportunity, verified, col, dir, 1);
  };
  const applySearch = (val: string) => { setQ(val); setPage(1); syncUrl(val, opportunity, verified, sortCol, sortDir, 1); };
  const applyOpportunity = (val: OpportunityFilter) => { setOpportunity(val); setPage(1); syncUrl(q, val, verified, sortCol, sortDir, 1); };
  const applyVerified    = (val: VerifiedFilter)    => { setVerified(val);    setPage(1); syncUrl(q, opportunity, val, sortCol, sortDir, 1); };
  const applyPage   = (p: number)   => { setPage(p); syncUrl(q, opportunity, verified, sortCol, sortDir, p); };

  const handleExport = () => {
    // `sorted` is the filtered (search + opportunity + verification), sorted
    // dataset already driving the table below — the export always reflects
    // exactly what's currently on screen, never the full unfiltered rows.
    const headers = [
      "Venue", "City", "Verification Status", "Current Plan", "Health Score %", "Published",
      "Upgrade Opportunities", "Venue Views (30d)", "Operator Email", "Last Login", "Days Since Last Login",
    ];
    const csvRows = sorted.map((r) => {
      const dsl = daysSince(r.operatorLastSeenAt);
      return [
        r.name, r.city, r.isVerified ? "Verified" : "Unverified", r.plan, String(r.setupHealthScorePct),
        r.isPublished ? "Yes" : "No", r.limitingFactor,
        String(r.venueViews30d), r.operatorEmail, fmtDate(r.operatorLastSeenAt),
        dsl != null ? String(dsl) : "",
      ];
    });
    downloadCsv(`upgrade-opportunities-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, csvRows));
  };

  const TH  = "group inline-flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors whitespace-nowrap";
  const THS = "text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";
  const selectCls =
    "text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white " +
    "text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={q} onChange={(e) => applySearch(e.target.value)}
          placeholder="Search venues or city…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <select
          value={opportunity}
          onChange={(e) => applyOpportunity(e.target.value as OpportunityFilter)}
          className={selectCls}
        >
          <option value="all">All Opportunities</option>
          {UPGRADE_OPPORTUNITY_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <select
          value={verified}
          onChange={(e) => applyVerified(e.target.value as VerifiedFilter)}
          className={selectCls}
        >
          <option value="all">All Venues</option>
          <option value="verified">Verified</option>
          <option value="unverified">Unverified</option>
        </select>
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
                    <th className="text-left px-4 py-3"><span className={THS}>Verified</span></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("plan")} className={TH}>Current Plan <SortIcon active={sortCol === "plan"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("setupHealthScorePct")} className={TH}>Health <SortIcon active={sortCol === "setupHealthScorePct"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Published</span></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Limiting Factor</span></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("venueViews30d")} className={TH}>Venue Views (30d) <SortIcon active={sortCol === "venueViews30d"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Operator</span></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("operatorLastSeenAt")} className={TH}>Last Login <SortIcon active={sortCol === "operatorLastSeenAt"} dir={sortDir} /></button></th>
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
                        <td className="px-4 py-3"><VerifiedBadge verified={r.isVerified} /></td>
                        <td className="px-4 py-3"><PlanBadge plan={r.plan} /></td>
                        <td className="px-4 py-3"><HealthBadge pct={r.setupHealthScorePct} /></td>
                        <td className="px-4 py-3">
                          {r.isPublished
                            ? <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Published</span>
                            : <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">Draft</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-orange-700 font-medium">{r.limitingFactor}</td>
                        <td className="px-4 py-3 text-gray-600 tabular-nums">{r.venueViews30d.toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-[180px]">
                          {r.operatorEmail ? (
                            <span className="inline-flex items-center gap-1 max-w-full">
                              <span className="truncate">{r.operatorEmail}</span>
                              <CopyButton value={r.operatorEmail} />
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                          {r.operatorLastSeenAt
                            ? <>{fmtDate(r.operatorLastSeenAt)}{dsl != null && <span className="text-gray-400 ml-1">({dsl}d ago)</span>}</>
                            : <span className="text-gray-300">—</span>}
                        </td>
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
