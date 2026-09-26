"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { SortIcon, Pagination } from "@/components/TableControls";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import type { SpecialsAdoptionRow } from "@/lib/data/specialsAdoption";
import { ONBOARDING_STATUS_LABELS } from "@/lib/customerSuccess/specialsAdoptionPolicy";

type SortCol =
  | "name"
  | "activation"
  | "onboarding"
  | "venueViews30d"
  | "operatorTotal"
  | "operatorCurrentOrUpcoming"
  | "platformTotal";

const PAGE_SIZE = 25;

function readUrlParam(key: string, fb: string): string {
  return new URLSearchParams(window.location.search).get(key) ?? fb;
}

/** Preserves ?view= (server-side tab) while syncing this table's own params. */
function syncUrl(q: string, sort: string, dir: string, page: number) {
  const current = new URLSearchParams(window.location.search);
  const p = new URLSearchParams();
  const view = current.get("view");
  if (view) p.set("view", view);
  if (q) p.set("q", q);
  if (sort) p.set("sort", sort);
  if (sort && dir !== "desc") p.set("dir", dir);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
}

const ONBOARDING_STYLES: Record<SpecialsAdoptionRow["onboardingStatus"], string> = {
  complete: "bg-green-100 text-green-700",
  in_progress: "bg-amber-100 text-amber-700",
  not_started: "bg-gray-100 text-gray-600",
  not_activated: "bg-gray-100 text-gray-500",
  no_operator: "bg-gray-100 text-gray-400",
};

export default function SpecialsAdoptionTable({ rows, csvName }: { rows: SpecialsAdoptionRow[]; csvName: string }) {
  const [q, setQ] = useState("");
  // "" = the server's default order (adopters first, then zero-Special venues by views).
  const [sortCol, setSortCol] = useState<SortCol | "">("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setQ(readUrlParam("q", ""));
    setSortCol(readUrlParam("sort", "") as SortCol | "");
    setSortDir(readUrlParam("dir", "desc") as "asc" | "desc");
    setPage(Math.max(1, parseInt(readUrlParam("page", "1"), 10)));
  }, []);

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return rows.filter((r) => !lq || r.name.toLowerCase().includes(lq) || (r.city?.toLowerCase().includes(lq) ?? false));
  }, [rows, q]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        // Unknown activation sorts as the youngest (-1).
        case "activation": cmp = (a.daysSinceActivation ?? -1) - (b.daysSinceActivation ?? -1); break;
        case "onboarding": cmp = a.onboardingStatus.localeCompare(b.onboardingStatus); break;
        case "venueViews30d": cmp = a.venueViews30d - b.venueViews30d; break;
        case "operatorTotal": cmp = a.counts.operatorTotal - b.counts.operatorTotal; break;
        case "operatorCurrentOrUpcoming": cmp = a.counts.operatorCurrentOrUpcoming - b.counts.operatorCurrentOrUpcoming; break;
        case "platformTotal": cmp = a.counts.platformTotal - b.counts.platformTotal; break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const applySort = (col: SortCol) => {
    const dir = col === sortCol && sortDir === "desc" ? "asc" : "desc";
    setSortCol(col); setSortDir(dir); setPage(1); syncUrl(q, col, dir, 1);
  };
  const applySearch = (val: string) => { setQ(val); setPage(1); syncUrl(val, sortCol, sortDir, 1); };
  const applyPage = (p: number) => { setPage(p); syncUrl(q, sortCol, sortDir, p); };

  const handleExport = () => {
    const headers = [
      "Venue", "City", "Control Panel URL", "Account activated", "Days since account activated",
      "Onboarding", "Stage", "Venue views (last 30 days)", "Operator-created Daily Specials (total)",
      "Operator-created drafts", "Operator-created current/upcoming (published)", "Seeded/platform Daily Specials",
      "Campaign candidate",
    ];
    const origin = window.location.origin;
    const csvRows = sorted.map((r) => [
      r.name, r.city ?? "", `${origin}/control-panel/venues/${r.id}`,
      r.accountActivatedAt ? fmtDate(r.accountActivatedAt) : "",
      r.daysSinceActivation === null ? "" : String(r.daysSinceActivation),
      ONBOARDING_STATUS_LABELS[r.onboardingStatus], r.stageLabel, String(r.venueViews30d),
      String(r.counts.operatorTotal), String(r.counts.operatorDrafts), String(r.counts.operatorCurrentOrUpcoming),
      String(r.counts.platformTotal), r.isCampaignCandidate ? "Yes" : "No",
    ]);
    downloadCsv(`${csvName}-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, csvRows));
  };

  const TH = "group inline-flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors whitespace-nowrap";
  const THS = "text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";
  const sortIcon = (col: SortCol) => <SortIcon active={sortCol === col} dir={sortDir} />;

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
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("name")} className={TH}>Venue {sortIcon("name")}</button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("activation")} className={TH}>Since Account Activated {sortIcon("activation")}</button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("onboarding")} className={TH}>Onboarding / Stage {sortIcon("onboarding")}</button></th>
                    <th className="text-right px-4 py-3"><button onClick={() => applySort("venueViews30d")} className={TH}>Venue Views (30d) {sortIcon("venueViews30d")}</button></th>
                    <th className="text-right px-4 py-3"><button onClick={() => applySort("operatorTotal")} className={TH}>Operator-Created {sortIcon("operatorTotal")}</button></th>
                    <th className="text-right px-4 py-3"><button onClick={() => applySort("operatorCurrentOrUpcoming")} className={TH}>Current / Upcoming {sortIcon("operatorCurrentOrUpcoming")}</button></th>
                    <th className="text-right px-4 py-3"><button onClick={() => applySort("platformTotal")} className={TH}>Seeded / Platform {sortIcon("platformTotal")}</button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Campaign</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map((r) => (
                    <tr key={r.id} className="hover:bg-amber-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/control-panel/venues/${r.id}`} className="font-medium text-slate-900 hover:text-amber-700 hover:underline">
                          {r.name}
                        </Link>
                        <p className="text-xs text-gray-400">
                          {r.city ?? "—"}{!r.isPublished && " · Unpublished"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {r.daysSinceActivation !== null ? (
                          <>
                            {r.daysSinceActivation}d
                            <p className="text-xs text-gray-400">{fmtDate(r.accountActivatedAt)}</p>
                          </>
                        ) : (
                          <span className="text-gray-400">Not activated</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${ONBOARDING_STYLES[r.onboardingStatus]}`}>
                          {ONBOARDING_STATUS_LABELS[r.onboardingStatus]}
                        </span>
                        <p className="mt-0.5 text-xs text-gray-400">{r.stageLabel}</p>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{r.venueViews30d.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={r.counts.operatorTotal > 0 ? "font-semibold text-slate-900" : "text-gray-400"}>
                          {r.counts.operatorTotal}
                        </span>
                        {r.counts.operatorDrafts > 0 && (
                          <p className="text-xs text-gray-400">{r.counts.operatorDrafts} draft</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600 tabular-nums">{r.counts.operatorCurrentOrUpcoming}</td>
                      <td className="px-4 py-3 text-right text-gray-500 tabular-nums">{r.counts.platformTotal}</td>
                      <td className="px-4 py-3">
                        {r.isCampaignCandidate
                          ? <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Candidate</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
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
