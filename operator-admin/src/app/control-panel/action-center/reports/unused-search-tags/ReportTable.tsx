"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { SortIcon, Pagination, CopyButton } from "@/components/TableControls";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { PLAN_LABELS } from "@/lib/plans";
import type { UnusedSearchTagsRow } from "@/lib/data/actionCenter";

type SortCol =
  | "name" | "city" | "plan" | "operatorName"
  | "searchTagsUsed" | "searchTagsRemaining";

const PAGE_SIZE    = 25;
const DEFAULT_SORT: SortCol = "searchTagsRemaining";

// Existing Operator Admin deep-link pattern (see admin/analytics/page.tsx,
// admin/home/page.tsx, venueCompletion.ts, suggestedSteps.ts): the "section"
// query param expands the matching AccordionSection server-side, and the
// "#search-tags" hash scrolls to it.
const SEARCH_TAGS_DEEP_LINK = "/admin/venue?section=search-tags#search-tags";

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
  pro:     "bg-blue-100 text-blue-700",
  premium: "bg-purple-100 text-purple-700",
};

function PlanBadge({ plan }: { plan: string }) {
  const label = PLAN_LABELS[plan as keyof typeof PLAN_LABELS] ?? plan;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${PLAN_COLORS[plan] ?? "bg-gray-100 text-gray-600"}`}>
      {label}
    </span>
  );
}

export default function UnusedSearchTagsTable({ rows }: { rows: UnusedSearchTagsRow[] }) {
  // /admin/venue has no venue-ID parameter — it always renders whatever venue
  // the current session (or active impersonation) resolves to. So reaching a
  // specific, founder-selected venue's Search Tags section requires starting
  // an impersonation session for that venue first (same mechanism as the CP
  // venue detail page's "Open as Operator" button), then landing on the deep
  // link above — a plain link to the deep link alone would show the wrong
  // venue (or the founder's own account state).
  const impersonateFormRef = useRef<HTMLFormElement>(null);
  const impersonateVenueIdRef = useRef<HTMLInputElement>(null);

  const openSearchTagsInOperatorAdmin = (venueId: string) => {
    if (impersonateVenueIdRef.current) impersonateVenueIdRef.current.value = venueId;
    impersonateFormRef.current?.requestSubmit();
  };

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
      r.name.toLowerCase().includes(lq) ||
      (r.city?.toLowerCase().includes(lq) ?? false) ||
      r.operatorName.toLowerCase().includes(lq) ||
      r.operatorEmail.toLowerCase().includes(lq)
    );
  }, [rows, q]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":                 cmp = a.name.localeCompare(b.name); break;
        case "city":                 cmp = (a.city ?? "").localeCompare(b.city ?? ""); break;
        case "plan":                 cmp = a.plan.localeCompare(b.plan); break;
        case "operatorName":         cmp = a.operatorName.localeCompare(b.operatorName); break;
        case "searchTagsUsed":       cmp = a.searchTagsUsed - b.searchTagsUsed; break;
        case "searchTagsRemaining":  cmp = a.searchTagsRemaining - b.searchTagsRemaining; break;
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
    const headers = ["Venue", "City", "Admin Name", "Admin Email", "Plan", "Search Tags Used", "Search Tag Capacity", "Remaining Unused Capacity"];
    const csvRows = sorted.map((r) => [
      r.name, r.city, r.operatorName, r.operatorEmail, PLAN_LABELS[r.plan] ?? r.plan,
      String(r.searchTagsUsed), String(r.searchTagLimit), String(r.searchTagsRemaining),
    ]);
    downloadCsv(`unused-search-tags-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, csvRows));
  };

  const TH  = "group inline-flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors whitespace-nowrap";
  const THS = "text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={q} onChange={(e) => applySearch(e.target.value)}
          placeholder="Search venue, city, admin name, or email…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-72 focus:outline-none focus:ring-2 focus:ring-amber-400" />
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
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("operatorName")} className={TH}>Admin <SortIcon active={sortCol === "operatorName"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Admin Email</span></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("plan")} className={TH}>Plan <SortIcon active={sortCol === "plan"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("searchTagsUsed")} className={TH}>Search Tags Used <SortIcon active={sortCol === "searchTagsUsed"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("searchTagsRemaining")} className={TH}>Available <SortIcon active={sortCol === "searchTagsRemaining"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Action</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map((r) => (
                    <tr key={r.id} onClick={() => openSearchTagsInOperatorAdmin(r.id)}
                      className="hover:bg-amber-50 transition-colors cursor-pointer">
                      <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                      <td className="px-4 py-3 text-gray-600">{r.city ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-700">{r.operatorName}</td>
                      <td className="px-4 py-3 text-gray-500">
                        <span className="inline-flex items-center gap-1.5">
                          {r.operatorEmail}
                          <CopyButton value={r.operatorEmail} />
                        </span>
                      </td>
                      <td className="px-4 py-3"><PlanBadge plan={r.plan} /></td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums whitespace-nowrap">
                        {r.searchTagsUsed} / {r.searchTagLimit} used
                      </td>
                      <td className="px-4 py-3 text-green-700 font-medium tabular-nums whitespace-nowrap">
                        {r.searchTagsRemaining} available
                      </td>
                      <td className="px-4 py-3"><span className="text-xs font-medium text-amber-600">Open Search Tags →</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={safePage} totalPages={totalPages} onPage={applyPage} />
        </>
      )}

      {/* Hidden form — launches a Control Panel → Operator Admin impersonation
          session (same POST endpoint as the CP venue detail page's "Open as
          Operator" button) targeting this venue, landing directly on its
          Search Tags section. target="_blank" + a synchronous requestSubmit()
          call (no await beforehand) avoids popup-blocker issues, matching the
          existing ImpersonateButton pattern. */}
      <form
        ref={impersonateFormRef}
        method="post"
        action="/api/impersonate/start"
        target="_blank"
        className="hidden"
      >
        <input ref={impersonateVenueIdRef} type="hidden" name="venue_id" />
        <input type="hidden" name="redirect_to" value={SEARCH_TAGS_DEEP_LINK} />
      </form>
    </div>
  );
}
