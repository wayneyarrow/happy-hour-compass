"use client";

import { useState, useEffect, useMemo } from "react";
import { SortIcon, Pagination } from "@/components/TableControls";
import { type OperatorPlan, PLAN_LABELS } from "@/lib/plans";

// ── Types ──────────────────────────────────────────────────────────────────────

export type OperatorRow = {
  id: string;
  name: string | null;
  email: string;
  is_approved: boolean;
  plan: string;
  venueName: string | null;
  venueSlug: string | null;
  created_at: string;   // ISO string
  updated_at: string;   // ISO string
};

type SortCol = "email" | "venueName" | "plan" | "created_at" | "updated_at";

const PAGE_SIZE    = 25;
const DEFAULT_SORT: SortCol = "created_at";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function readUrlParam(key: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(key) ?? fallback;
}

function syncUrl(q: string, vq: string, sort: string, dir: string, page: number) {
  const p = new URLSearchParams();
  if (q)                    p.set("q",    q);
  if (vq)                   p.set("vq",   vq);
  if (sort !== DEFAULT_SORT) p.set("sort", sort);
  if (dir !== "desc")       p.set("dir",  dir);
  if (page > 1)             p.set("page", String(page));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const PLAN_STYLES: Record<OperatorPlan, string> = {
  free:       "bg-gray-100 text-gray-600",
  pro:        "bg-amber-100 text-amber-700",
  premium:    "bg-blue-100 text-blue-700",
  enterprise: "bg-purple-100 text-purple-700",
};

function PlanBadge({ plan }: { plan: string }) {
  const key    = (plan ?? "free") as OperatorPlan;
  const styles = PLAN_STYLES[key] ?? PLAN_STYLES.free;
  const label  = PLAN_LABELS[key]  ?? "Free";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles}`}>
      {label}
    </span>
  );
}

function ApprovedBadge({ approved }: { approved: boolean }) {
  return approved ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
      Approved
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
      Pending
    </span>
  );
}

// ── OperatorsTable ─────────────────────────────────────────────────────────────

export default function OperatorsTable({ rows }: { rows: OperatorRow[] }) {
  const [q,       setQ]       = useState("");
  const [vq,      setVq]      = useState("");
  const [sortCol, setSortCol] = useState<SortCol>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page,    setPage]    = useState(1);

  // Hydrate from URL on mount
  useEffect(() => {
    setQ(readUrlParam("q", ""));
    setVq(readUrlParam("vq", ""));
    setSortCol(readUrlParam("sort", DEFAULT_SORT) as SortCol);
    setSortDir(readUrlParam("dir", "desc") as "asc" | "desc");
    setPage(Math.max(1, parseInt(readUrlParam("page", "1"), 10)));
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return rows.filter((op) => {
      if (q) {
        const lq = q.toLowerCase();
        if (!op.name?.toLowerCase().includes(lq) && !op.email.toLowerCase().includes(lq))
          return false;
      }
      if (vq && !op.venueName?.toLowerCase().includes(vq.toLowerCase())) return false;
      return true;
    });
  }, [rows, q, vq]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "email":
          cmp = a.email.localeCompare(b.email);
          break;
        case "venueName":
          if (!a.venueName && !b.venueName) cmp = 0;
          else if (!a.venueName) cmp = 1;
          else if (!b.venueName) cmp = -1;
          else cmp = a.venueName.localeCompare(b.venueName);
          break;
        case "plan":
          cmp = a.plan.localeCompare(b.plan);
          break;
        case "created_at":
          cmp = a.created_at.localeCompare(b.created_at);
          break;
        case "updated_at":
          cmp = a.updated_at.localeCompare(b.updated_at);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ── State update helpers ──────────────────────────────────────────────────

  const applySort = (col: SortCol) => {
    const newDir = col === sortCol && sortDir === "desc" ? "asc" : "desc";
    setSortCol(col);
    setSortDir(newDir);
    setPage(1);
    syncUrl(q, vq, col, newDir, 1);
  };

  const applySearch = (val: string) => {
    setQ(val);
    setPage(1);
    syncUrl(val, vq, sortCol, sortDir, 1);
  };

  const applyVenueSearch = (val: string) => {
    setVq(val);
    setPage(1);
    syncUrl(q, val, sortCol, sortDir, 1);
  };

  const applyPage = (p: number) => {
    setPage(p);
    syncUrl(q, vq, sortCol, sortDir, p);
  };

  // ── Shared styles ─────────────────────────────────────────────────────────

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
          placeholder="Search by name or email…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <input
          type="search"
          value={vq}
          onChange={(e) => applyVenueSearch(e.target.value)}
          placeholder="Search by venue…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-48 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <span className="ml-auto text-sm text-gray-400">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No operators match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-slate-50">
                    <th className="text-left px-4 py-3">
                      <span className={thStaticCls}>Operator</span>
                    </th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => applySort("email")} className={thBtnCls}>
                        Email <SortIcon active={sortCol === "email"} dir={sortDir} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3">
                      <span className={thStaticCls}>Status</span>
                    </th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => applySort("plan")} className={thBtnCls}>
                        Plan <SortIcon active={sortCol === "plan"} dir={sortDir} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => applySort("venueName")} className={thBtnCls}>
                        Venue <SortIcon active={sortCol === "venueName"} dir={sortDir} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => applySort("created_at")} className={thBtnCls}>
                        Joined <SortIcon active={sortCol === "created_at"} dir={sortDir} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => applySort("updated_at")} className={thBtnCls}>
                        Updated <SortIcon active={sortCol === "updated_at"} dir={sortDir} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map((op) => (
                    <tr key={op.id} className="hover:bg-amber-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {op.name ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{op.email}</td>
                      <td className="px-4 py-3">
                        <ApprovedBadge approved={op.is_approved} />
                      </td>
                      <td className="px-4 py-3">
                        <PlanBadge plan={op.plan} />
                      </td>
                      <td className="px-4 py-3">
                        {op.venueName ? (
                          <>
                            {op.venueSlug ? (
                              <a
                                href={`/venue/${op.venueSlug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-slate-900 hover:text-amber-700 transition-colors"
                              >
                                {op.venueName}
                              </a>
                            ) : (
                              <span className="font-medium text-slate-900">{op.venueName}</span>
                            )}
                            {op.venueSlug && (
                              <div className="text-xs text-gray-400 mt-0.5 font-mono">
                                {op.venueSlug}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-300">No venue</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {fmtDate(op.created_at)}
                      </td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {fmtDate(op.updated_at)}
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
