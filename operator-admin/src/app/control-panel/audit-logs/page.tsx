import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Logs" };

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  claim_approved:                   "Claim approved",
  claim_rejected:                   "Claim rejected",
  claim_more_info_requested:        "Claim: more info requested",
  submission_approved:              "Submission approved",
  submission_closed:                "Submission closed",
  submission_more_info_requested:   "Submission: more info requested",
  submission_note_added:            "Submission note added",
  discover_spotlight_enabled:       "Spotlight enabled",
  discover_spotlight_disabled:      "Spotlight disabled",
  discover_boost_changed:           "Boost changed",
  discover_venue_excluded:          "Venue excluded from discover",
  discover_venue_included:          "Venue included in discover",
  platform_admin_invited:           "Platform admin invited",
  platform_admin_activated:         "Platform admin activated",
  platform_admin_revoked:           "Platform admin revoked",
  operator_member_invited:          "Team member invited",
  operator_member_removed:          "Team member removed",
  operator_member_invite_accepted:  "Team member invite accepted",
  plan_changed:                     "Plan changed",
  venue_bulk_published:             "Venues bulk published",
};

function formatAction(action: string): string {
  return (
    ACTION_LABELS[action] ??
    action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day:   "numeric",
    year:  "numeric",
  });
}

function buildUrl(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q)      params.set("q",    q);
  if (page > 1) params.set("page", String(page));
  const str = params.toString();
  return `/control-panel/audit-logs${str ? `?${str}` : ""}`;
}

type AuditLogRow = {
  id:          string;
  created_at:  string;
  actor_email: string;
  action:      string;
  entity_type: string;
  entity_id:   string | null;
  entity_name: string | null;
};

export default async function AuditLogsPage(props: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const searchParams = await props.searchParams;
  const q      = (searchParams.q ?? "").trim();
  const page   = Math.max(1, parseInt(searchParams.page ?? "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("audit_logs")
    .select(
      "id, created_at, actor_email, action, entity_type, entity_id, entity_name",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (q) {
    query = query.or(
      `actor_email.ilike.%${q}%,entity_name.ilike.%${q}%,action.ilike.%${q}%`
    );
  }

  const { data, count, error } = await query;
  const logs       = (data ?? []) as AuditLogRow[];
  const totalCount = count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="max-w-7xl">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1>
        <p className="mt-1 text-sm text-gray-500">
          High-value platform actions — who did it, what, and when.
        </p>
      </div>

      {/* Search */}
      <form method="GET" action="/control-panel/audit-logs" className="mb-4">
        <div className="flex gap-2 max-w-md">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search by user, action, or object…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            Search
          </button>
          {q && (
            <Link
              href="/control-panel/audit-logs"
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg text-sm transition-colors"
            >
              Clear
            </Link>
          )}
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700 mb-4">
          Failed to load audit logs: {(error as { message?: string }).message ?? "Unknown error"}
        </div>
      )}

      {/* Empty state */}
      {!error && logs.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <h2 className="text-base font-semibold text-slate-900 mb-1">No events found</h2>
          <p className="text-sm text-gray-500">
            {q
              ? "No audit log entries matched your search."
              : "Platform actions will appear here as they happen."}
          </p>
        </div>
      )}

      {/* Table */}
      {!error && logs.length > 0 && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-52">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Object
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                      {formatDate(log.created_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs">
                      {log.actor_email}
                    </td>
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {formatAction(log.action)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {log.entity_name ?? log.entity_id ?? (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Page {page} of {totalPages} · {totalCount.toLocaleString()} events
              </p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={buildUrl(q, page - 1)}
                    className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition-colors"
                  >
                    ← Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={buildUrl(q, page + 1)}
                    className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium transition-colors"
                  >
                    Next →
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
