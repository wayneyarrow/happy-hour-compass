"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SortIcon, Pagination } from "@/components/TableControls";
import { buildCsv, downloadCsv } from "@/lib/csvExport";
import { formatDateTime } from "@/lib/controlPanelDateTime";
import ActivationBadge from "@/components/ActivationBadge";
import type { ActivationReviewRow, ActivationReviewReason } from "@/lib/activation/activationReviews";

type SortCol = "venue" | "operator" | "originType" | "deadlineAt";

const PAGE_SIZE = 25;

const REASON_LABELS: Record<ActivationReviewReason, string> = {
  release_required: "Release required",
  expired: "Expired — awaiting review",
  reminder_exhausted: "Reminders exhausted",
  notification_incomplete: "Notification incomplete",
};

function ReasonPills({ reasons }: { reasons: ActivationReviewReason[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {reasons.map((r) => (
        <span key={r} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-50 text-red-600">
          {REASON_LABELS[r]}
        </span>
      ))}
    </div>
  );
}

function reminderProgressText(row: ActivationReviewRow): string {
  if (row.expiredAt) return "—";
  return `Stage ${row.reminderStage} of 3 resolved`;
}

function notificationText(row: ActivationReviewRow): string | null {
  if (!row.expiredAt) return null;
  const slack = row.expirySlackNotifiedAt ? "Slack ✓" : "Slack pending";
  const email = row.expiryFounderEmailSentAt ? "Email ✓" : "Email pending";
  return `${slack} · ${email}`;
}

export default function OperatorActivationReviewsTable({ rows }: { rows: ActivationReviewRow[] }) {
  const router = useRouter();

  const [q, setQ] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("deadlineAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    if (!lq) return rows;
    return rows.filter(
      (r) =>
        (r.venueName?.toLowerCase().includes(lq) ?? false) ||
        (r.operatorName?.toLowerCase().includes(lq) ?? false) ||
        (r.operatorEmail?.toLowerCase().includes(lq) ?? false)
    );
  }, [rows, q]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "venue": cmp = (a.venueName ?? "").localeCompare(b.venueName ?? ""); break;
        case "operator": cmp = (a.operatorName ?? a.operatorEmail ?? "").localeCompare(b.operatorName ?? b.operatorEmail ?? ""); break;
        case "originType": cmp = a.originType.localeCompare(b.originType); break;
        case "deadlineAt": cmp = a.deadlineAt.localeCompare(b.deadlineAt); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const applySort = (col: SortCol) => {
    const dir = col === sortCol && sortDir === "asc" ? "desc" : "asc";
    setSortCol(col); setSortDir(dir); setPage(1);
  };

  const detailHref = (row: ActivationReviewRow) =>
    row.originType === "claim" ? `/control-panel/claims/${row.originId}` : `/control-panel/operator-submissions/${row.originId}`;

  const handleExport = () => {
    const headers = ["Venue", "Operator", "Origin", "State", "Reasons", "Deadline", "Reminder progress", "Last error", "Notification status"];
    const csvRows = sorted.map((r) => [
      r.venueName ?? "", r.operatorName ?? r.operatorEmail ?? "",
      r.originType === "claim" ? "Claim" : "Submission",
      r.state, r.reasons.map((x) => REASON_LABELS[x]).join("; "),
      r.deadlineAt, reminderProgressText(r), r.reminderLastError ?? "", notificationText(r) ?? "",
    ]);
    downloadCsv(`operator-activation-reviews-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, csvRows));
  };

  const TH = "group inline-flex items-center text-xs font-semibold text-gray-500 uppercase tracking-wide hover:text-gray-700 transition-colors whitespace-nowrap";
  const THS = "text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Search venue or operator…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-60 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <span className="ml-auto text-sm text-gray-400">{filtered.length} of {rows.length}</span>
        <button type="button" onClick={handleExport} disabled={sorted.length === 0}
          className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
          Export CSV
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm text-gray-400">No records match the current search.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-slate-50">
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("venue")} className={TH}>Venue <SortIcon active={sortCol === "venue"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("operator")} className={TH}>Operator <SortIcon active={sortCol === "operator"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("originType")} className={TH}>Origin <SortIcon active={sortCol === "originType"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>State</span></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Reason</span></th>
                    <th className="text-left px-4 py-3"><button onClick={() => applySort("deadlineAt")} className={TH}>Deadline <SortIcon active={sortCol === "deadlineAt"} dir={sortDir} /></button></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Reminder progress</span></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Last attempt/error</span></th>
                    <th className="text-left px-4 py-3"><span className={THS}>Notification</span></th>
                    <th className="text-left px-4 py-3"><span className={THS}>View</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageRows.map((r) => (
                    <tr key={r.lifecycleId} onClick={() => router.push(detailHref(r))} className="hover:bg-amber-50 transition-colors cursor-pointer">
                      <td className="px-4 py-3 font-medium text-slate-900">{r.venueName ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-600">{r.operatorName ?? r.operatorEmail ?? <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{r.originType === "claim" ? "Claim" : "Submission"}</td>
                      <td className="px-4 py-3"><ActivationBadge state={r.state} /></td>
                      <td className="px-4 py-3"><ReasonPills reasons={r.reasons} /></td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{formatDateTime(r.deadlineAt)}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{reminderProgressText(r)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate" title={r.reminderLastError ?? undefined}>{r.reminderLastError ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{notificationText(r) ?? "—"}</td>
                      <td className="px-4 py-3"><span className="text-xs font-medium text-amber-600">View →</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={safePage} totalPages={totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
