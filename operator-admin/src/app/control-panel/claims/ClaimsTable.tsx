"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination } from "@/components/TableControls";
import type { ClaimWithVenue } from "@/lib/data/claims";

// ── Types ──────────────────────────────────────────────────────────────────────

type Row = ClaimWithVenue & { submitted: string; updated: string };

type SortCol      = "venue_name" | "claimant" | "status" | "created_at" | "updated_at";
type StatusFilter = "all" | "pending" | "approved" | "needs_more_info" | "info_submitted" | "rejected";

const PAGE_SIZE    = 25;
const DEFAULT_SORT: SortCol = "created_at";

// ── Status badge config ─────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; classes: string }> = {
  pending:         { label: "Pending",         classes: "bg-amber-100 text-amber-700" },
  approved:        { label: "Approved",        classes: "bg-green-100 text-green-700" },
  needs_more_info: { label: "Needs more info", classes: "bg-blue-100 text-blue-600" },
  info_submitted:  { label: "Info submitted",  classes: "bg-purple-100 text-purple-700" },
  rejected:        { label: "Rejected",        classes: "bg-red-100 text-red-700" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS[status] ?? { label: status, classes: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readUrlParam(key: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(key) ?? fallback;
}

function syncUrl(q: string, status: string, sort: string, dir: string, page: number) {
  const p = new URLSearchParams();
  if (q)                    p.set("q",      q);
  if (status !== "all")     p.set("status", status);
  if (sort !== DEFAULT_SORT) p.set("sort",  sort);
  if (dir !== "desc")       p.set("dir",    dir);
  if (page > 1)             p.set("page",   String(page));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

// ── ClaimsTable ───────────────────────────────────────────────────────────────

export default function ClaimsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();

  const [q,       setQ]       = useState("");
  const [status,  setStatus]  = useState<StatusFilter>("all");
  const [sortCol, setSortCol] = useState<SortCol>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page,    setPage]    = useState(1);

  // Hydrate from URL on mount
  useEffect(() => {
    setQ(readUrlParam("q", ""));
    setStatus(readUrlParam("status", "all") as StatusFilter);
    setSortCol(readUrlParam("sort", DEFAULT_SORT) as SortCol);
    setSortDir(readUrlParam("dir", "desc") as "asc" | "desc");
    setPage(Math.max(1, parseInt(readUrlParam("page", "1"), 10)));
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return rows.filter((r) => {
      if (lq) {
        const claimant = `${r.first_name} ${r.last_name}`.toLowerCase();
        if (!r.venue_name?.toLowerCase().includes(lq) &&
            !claimant.includes(lq) &&
            !r.email.toLowerCase().includes(lq)) return false;
      }
      if (status !== "all" && r.status !== status) return false;
      return true;
    });
  }, [rows, q, status]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "venue_name":
          cmp = (a.venue_name ?? "").localeCompare(b.venue_name ?? "");
          break;
        case "claimant":
          cmp = `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
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
    syncUrl(q, status, col, newDir, 1);
  };

  const applySearch = (val: string) => {
    setQ(val);
    setPage(1);
    syncUrl(val, status, sortCol, sortDir, 1);
  };

  const applyStatus = (val: StatusFilter) => {
    setStatus(val);
    setPage(1);
    syncUrl(q, val, sortCol, sortDir, 1);
  };

  const applyPage = (p: number) => {
    setPage(p);
    syncUrl(q, status, sortCol, sortDir, p);
  };

  // ── Shared styles ─────────────────────────────────────────────────────────

  const selectCls =
    "text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white " +
    "text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400";

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
          placeholder="Search venue, claimant, or email…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-64 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <select
          value={status}
          onChange={(e) => applyStatus(e.target.value as StatusFilter)}
          className={selectCls}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="needs_more_info">Needs more info</option>
          <option value="info_submitted">Info submitted</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <span className="ml-auto text-sm text-gray-400">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No claims match the current filters.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("venue_name")} className={thBtnCls}>
                      Venue <SortIcon active={sortCol === "venue_name"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("claimant")} className={thBtnCls}>
                      Claimant <SortIcon active={sortCol === "claimant"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Role</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Email</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Phone</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("status")} className={thBtnCls}>
                      Status <SortIcon active={sortCol === "status"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("created_at")} className={thBtnCls}>
                      Submitted <SortIcon active={sortCol === "created_at"} dir={sortDir} />
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
                {pageRows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => router.push(`/control-panel/claims/${row.id}`)}
                    className="hover:bg-amber-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                      {row.venue_name ?? <span className="text-gray-400 italic">Unknown</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {row.first_name} {row.last_name}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{row.position}</td>
                    <td className="px-4 py-3 text-gray-600">{row.email}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{row.phone}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{row.submitted}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{row.updated}</td>
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
