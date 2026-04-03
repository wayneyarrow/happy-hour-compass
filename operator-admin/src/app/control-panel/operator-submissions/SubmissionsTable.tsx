"use client";

import { useRouter } from "next/navigation";
import type { OperatorSubmissionRow } from "@/lib/data/operatorSubmissions";

// ── Badge configs ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  confirmed_auto:   { label: "Confirmed auto",   classes: "bg-green-100 text-green-700" },
  double_claim:     { label: "Double claim",     classes: "bg-red-100 text-red-700" },
  rejected_by_user: { label: "Rejected by user", classes: "bg-orange-100 text-orange-700" },
  no_match:         { label: "No match",         classes: "bg-gray-100 text-gray-600" },
  new:              { label: "New",              classes: "bg-amber-100 text-amber-700" },
  approved:         { label: "Approved",         classes: "bg-green-100 text-green-700" },
  rejected:         { label: "Rejected",         classes: "bg-red-100 text-red-700" },
  converted_to_operator: { label: "Converted", classes: "bg-blue-100 text-blue-700" },
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
  return (
    <span title={label} className={`inline-block w-2 h-2 rounded-full ${color}`} />
  );
}

function TrustSummary({ row }: { row: OperatorSubmissionRow }) {
  const roleDot =
    row.role_trust_level === "strong"   ? "bg-green-400" :
    row.role_trust_level === "moderate" ? "bg-amber-400" :
    row.role_trust_level === "weak"     ? "bg-red-400"   :
                                          "bg-gray-300";
  return (
    <div className="flex items-center gap-1.5" title={`Domain match / Public email / Role: ${row.role_trust_level ?? "—"}`}>
      <TrustDot value={row.email_domain_matches_website} label="Domain matches website" />
      <TrustDot
        value={row.is_public_email_domain === null ? null : !row.is_public_email_domain}
        label="Business email (not public)"
      />
      <span title={`Role: ${row.role_trust_level ?? "—"}`} className={`inline-block w-2 h-2 rounded-full ${roleDot}`} />
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────────

type Row = OperatorSubmissionRow & { submitted: string };

export default function SubmissionsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
        <thead className="bg-gray-50">
          <tr>
            {["Submitted", "Business", "Submitter", "Position", "Status", "Match", "Venue", "Trust"].map((h) => (
              <th
                key={h}
                scope="col"
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => router.push(`/control-panel/operator-submissions/${row.id}`)}
              className="hover:bg-amber-50 cursor-pointer transition-colors"
            >
              {/* Submitted */}
              <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                {row.submitted}
              </td>

              {/* Business */}
              <td className="px-4 py-3 whitespace-nowrap">
                <p className="font-medium text-gray-900">{row.venue_name}</p>
                {(row.city || row.province) && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[row.city, row.province].filter(Boolean).join(", ")}
                  </p>
                )}
              </td>

              {/* Submitter */}
              <td className="px-4 py-3">
                <p className="text-gray-800 whitespace-nowrap">
                  {[row.first_name, row.last_name].filter(Boolean).join(" ") || "—"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{row.email}</p>
              </td>

              {/* Position */}
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                {row.position || "—"}
              </td>

              {/* Status */}
              <td className="px-4 py-3 whitespace-nowrap">
                <StatusBadge status={row.status} />
              </td>

              {/* Match */}
              <td className="px-4 py-3 whitespace-nowrap">
                <MatchBadge status={row.match_status} />
              </td>

              {/* Venue linked */}
              <td className="px-4 py-3 text-center">
                {row.venue_id ? (
                  <span title="Venue linked" className="inline-block w-2 h-2 rounded-full bg-green-400" />
                ) : (
                  <span className="text-gray-300 text-xs">—</span>
                )}
              </td>

              {/* Trust summary */}
              <td className="px-4 py-3">
                <TrustSummary row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
