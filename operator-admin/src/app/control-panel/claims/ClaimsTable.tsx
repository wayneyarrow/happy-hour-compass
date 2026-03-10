"use client";

import { useRouter } from "next/navigation";
import type { ClaimWithVenue } from "@/lib/data/claims";

// ── Status badge config ─────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; classes: string }> = {
  pending:         { label: "Pending",         classes: "bg-amber-100 text-amber-700" },
  approved:        { label: "Approved",        classes: "bg-green-100 text-green-700" },
  needs_more_info: { label: "Needs more info", classes: "bg-blue-100 text-blue-600" },
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

// ── Table ───────────────────────────────────────────────────────────────────

type Row = ClaimWithVenue & { submitted: string };

export default function ClaimsTable({ rows }: { rows: Row[] }) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
        <thead className="bg-gray-50">
          <tr>
            {["Venue", "Claimant", "Role", "Email", "Phone", "Status", "Submitted"].map((h) => (
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
