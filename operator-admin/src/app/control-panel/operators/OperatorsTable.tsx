"use client";

import { useState, useEffect, useMemo } from "react";
import { SortIcon, Pagination } from "@/components/TableControls";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { type OperatorPlan, PLAN_LABELS } from "@/lib/plans";
import StatusBadge, { type StatusVariant } from "@/components/StatusBadge";
import { formatDate as fmtDate } from "@/lib/controlPanelDateTime";

// ── Types ──────────────────────────────────────────────────────────────────────

export type OperatorRow = {
  id: string;
  name: string | null;
  email: string;
  is_approved: boolean;
  /**
   * Phase 2B billing review (Part 8): NOT the operator's own subscription —
   * plan is venue-level, and a multi-venue operator's venues can hold
   * different plans. This is the highest plan among that operator's
   * current venues (see getOperatorHighestVenuePlan()'s doc comment for the
   * same rule applied to team seats). Labelled "Highest Venue Plan" in the
   * table header specifically so it is never mistaken for an operator-wide
   * billing subscription — there is no such thing any more.
   */
  highestVenuePlan: string;
  venueName: string | null;
  venueSlug: string | null;
  created_at: string;   // ISO string
  updated_at: string;   // ISO string
};

type SortCol = "email" | "venueName" | "plan" | "created_at" | "updated_at";

const PAGE_SIZE    = 25;
const DEFAULT_SORT: SortCol = "created_at";


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

// ── Plan badge variant map ─────────────────────────────────────────────────────

const PLAN_BADGE_VARIANT: Record<OperatorPlan, StatusVariant> = {
  free:       "neutral",
  pro:        "warning",
  premium:    "info",
  enterprise: "enterprise",
};

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
          cmp = a.highestVenuePlan.localeCompare(b.highestVenuePlan);
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

  const handleExport = () => {
    const headers = ["Email", "Venue", "Highest Venue Plan", "Joined", "Updated"];
    const csvRows = sorted.map((op) => [
      op.email,
      op.venueName,
      PLAN_LABELS[op.highestVenuePlan as OperatorPlan] ?? op.highestVenuePlan,
      fmtDate(op.created_at),
      fmtDate(op.updated_at),
    ]);
    downloadCsv(
      `operators-${new Date().toISOString().slice(0, 10)}.csv`,
      buildCsv(headers, csvRows)
    );
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
        <button
          type="button"
          onClick={handleExport}
          disabled={sorted.length === 0}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          Export CSV
        </button>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No operators match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Operator</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("email")} className={thBtnCls}>
                      Email <SortIcon active={sortCol === "email"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("plan")} className={thBtnCls} title="Highest plan among this operator's current venues — not a single operator-wide subscription">
                      Highest Venue Plan <SortIcon active={sortCol === "plan"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("venueName")} className={thBtnCls}>
                      Venue <SortIcon active={sortCol === "venueName"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("created_at")} className={thBtnCls}>
                      Joined <SortIcon active={sortCol === "created_at"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("updated_at")} className={thBtnCls}>
                      Updated <SortIcon active={sortCol === "updated_at"} dir={sortDir} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageRows.map((op) => {
                  const planKey     = (op.highestVenuePlan ?? "free") as OperatorPlan;
                  const planVariant = PLAN_BADGE_VARIANT[planKey] ?? "neutral";
                  const planLabel   = PLAN_LABELS[planKey] ?? "Free";
                  return (
                    <tr key={op.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {op.name ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{op.email}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge variant={planVariant} label={planLabel} />
                      </td>
                      <td className="px-4 py-3">
                        {op.venueName ? (
                          <>
                            {op.venueSlug ? (
                              <a
                                href={`/venue/${op.venueSlug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-slate-900 hover:text-amber-600 transition-colors"
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
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {fmtDate(op.created_at)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {fmtDate(op.updated_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={safePage} totalPages={totalPages} onPage={applyPage} />
        </>
      )}
    </div>
  );
}
