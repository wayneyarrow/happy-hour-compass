"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination } from "@/components/TableControls";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import type { OperatorSubmissionRow } from "@/lib/data/operatorSubmissions";

// ── Types ──────────────────────────────────────────────────────────────────────

type Row = OperatorSubmissionRow & { submitted: string; updated: string };

type SortCol = "venue_name" | "status" | "submitted_at" | "updated_at";

const PAGE_SIZE    = 25;
const DEFAULT_SORT: SortCol = "submitted_at";

// ── Badge configs ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  confirmed_auto:       { label: "Confirmed auto",   classes: "bg-green-100 text-green-700" },
  double_claim:         { label: "Double claim",     classes: "bg-red-100 text-red-700" },
  rejected_by_user:     { label: "Rejected by user", classes: "bg-orange-100 text-orange-700" },
  no_match:             { label: "No match",         classes: "bg-gray-100 text-gray-600" },
  new:                  { label: "New",              classes: "bg-amber-100 text-amber-700" },
  approved:             { label: "Approved",         classes: "bg-green-100 text-green-700" },
  rejected:             { label: "Rejected",         classes: "bg-red-100 text-red-700" },
  converted_to_operator:{ label: "Converted",        classes: "bg-blue-100 text-blue-700" },
};

const MATCH_STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  confirmed: { label: "Confirmed", classes: "bg-green-50 text-green-700 border border-green-200" },
  rejected:  { label: "Rejected",  classes: "bg-orange-50 text-orange-700 border border-orange-200" },
  no_match:  { label: "No match",  classes: "bg-gray-50 text-gray-600 border border-gray-200" },
  pending:   { label: "Pending",   classes: "bg-amber-50 text-amber-700 border border-amber-200" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, classes: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

function MatchBadge({ status }: { status: string }) {
  const cfg = MATCH_STATUS_CONFIG[status] ?? { label: status, classes: "bg-gray-50 text-gray-600 border border-gray-200" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── Trust summary ─────────────────────────────────────────────────────────────

function TrustDot({ value, label }: { value: boolean | null; label: string }) {
  const color =
    value === true  ? "bg-green-400" :
    value === false ? "bg-red-400"   :
                      "bg-gray-300";
  return <span title={label} className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function TrustSummary({ row }: { row: OperatorSubmissionRow }) {
  const roleDot =
    row.role_trust_level === "strong"   ? "bg-green-400" :
    row.role_trust_level === "moderate" ? "bg-amber-400" :
    row.role_trust_level === "weak"     ? "bg-red-400"   :
                                          "bg-gray-300";
  return (
    <div
      className="flex items-center gap-1.5"
      title={`Domain match / Public email / Role: ${row.role_trust_level ?? "—"}`}
    >
      <TrustDot value={row.email_domain_matches_website} label="Domain matches website" />
      <TrustDot
        value={row.is_public_email_domain === null ? null : !row.is_public_email_domain}
        label="Business email (not public)"
      />
      <span
        title={`Role: ${row.role_trust_level ?? "—"}`}
        className={`inline-block w-2 h-2 rounded-full ${roleDot}`}
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readUrlParam(key: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(key) ?? fallback;
}

function syncUrl(q: string, sort: string, dir: string, page: number) {
  const p = new URLSearchParams(window.location.search);
  // Preserve existing params (e.g. tab) but overwrite ours
  if (q)                    p.set("q",    q);    else p.delete("q");
  if (sort !== DEFAULT_SORT) p.set("sort", sort); else p.delete("sort");
  if (dir !== "desc")       p.set("dir",  dir);  else p.delete("dir");
  if (page > 1)             p.set("page", String(page)); else p.delete("page");
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

// ── SubmissionsTable ──────────────────────────────────────────────────────────

export default function SubmissionsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();

  const [q,       setQ]       = useState("");
  const [sortCol, setSortCol] = useState<SortCol>(DEFAULT_SORT);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page,    setPage]    = useState(1);

  // Hydrate from URL on mount
  useEffect(() => {
    setQ(readUrlParam("q", ""));
    setSortCol(readUrlParam("sort", DEFAULT_SORT) as SortCol);
    setSortDir(readUrlParam("dir", "desc") as "asc" | "desc");
    setPage(Math.max(1, parseInt(readUrlParam("page", "1"), 10)));
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    if (!lq) return rows;
    return rows.filter((r) => {
      const name = [r.first_name, r.last_name].filter(Boolean).join(" ").toLowerCase();
      return r.venue_name.toLowerCase().includes(lq) ||
             name.includes(lq) ||
             r.email.toLowerCase().includes(lq);
    });
  }, [rows, q]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "venue_name":
          cmp = a.venue_name.localeCompare(b.venue_name);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "submitted_at":
          cmp = a.submitted_at.localeCompare(b.submitted_at);
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
    syncUrl(q, col, newDir, 1);
  };

  const applySearch = (val: string) => {
    setQ(val);
    setPage(1);
    syncUrl(val, sortCol, sortDir, 1);
  };

  const applyPage = (p: number) => {
    setPage(p);
    syncUrl(q, sortCol, sortDir, p);
  };

  const handleExport = () => {
    const headers = ["Venue", "Submitter", "Email", "Status", "Submitted", "Updated"];
    const csvRows = sorted.map((r) => [
      r.venue_name,
      [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
      r.email,
      STATUS_CONFIG[r.status]?.label ?? r.status,
      r.submitted,
      r.updated,
    ]);
    downloadCsv(
      `submissions-${new Date().toISOString().slice(0, 10)}.csv`,
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
          placeholder="Search venue, submitter, or email…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-64 focus:outline-none focus:ring-2 focus:ring-amber-400"
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
          <p className="text-sm text-gray-400">No submissions match the current search.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("submitted_at")} className={thBtnCls}>
                      Submitted <SortIcon active={sortCol === "submitted_at"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("venue_name")} className={thBtnCls}>
                      Business <SortIcon active={sortCol === "venue_name"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Submitter</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Position</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <button onClick={() => applySort("status")} className={thBtnCls}>
                      Status <SortIcon active={sortCol === "status"} dir={sortDir} />
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Match</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Venue</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">
                    <span className={thStaticCls}>Trust</span>
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
                    onClick={() => router.push(`/control-panel/operator-submissions/${row.id}`)}
                    className="hover:bg-amber-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                      {row.submitted}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-medium text-gray-900">{row.venue_name}</p>
                      {(row.city || row.province) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {[row.city, row.province].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-800 whitespace-nowrap">
                        {[row.first_name, row.last_name].filter(Boolean).join(" ") || "—"}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{row.email}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {row.position || "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <MatchBadge status={row.match_status} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.venue_id ? (
                        <span title="Venue linked" className="inline-block w-2 h-2 rounded-full bg-green-400" />
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <TrustSummary row={row} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                      {row.updated}
                    </td>
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
