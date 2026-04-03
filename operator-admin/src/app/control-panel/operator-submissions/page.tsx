import Link from "next/link";
import { getOperatorSubmissions } from "@/lib/data/operatorSubmissions";
import SubmissionsTable from "./SubmissionsTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operator Submissions" };

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS = [
  { key: "needs_review",   label: "Needs Review" },
  { key: "confirmed_auto", label: "Confirmed Auto" },
  { key: "all",            label: "All" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function isValidTab(tab: string | undefined): tab is TabKey {
  return TABS.some((t) => t.key === tab);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day:   "numeric",
    year:  "numeric",
    hour:  "numeric",
    minute: "2-digit",
  });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function OperatorSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawTab = typeof params.tab === "string" ? params.tab : undefined;
  const activeTab: TabKey = isValidTab(rawTab) ? rawTab : "needs_review";

  const { submissions, error } = await getOperatorSubmissions(activeTab);

  return (
    <div className="max-w-7xl">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Operator Submissions</h1>
          <p className="mt-1 text-sm text-gray-500">
            Pre-auth intake from operators who want to list or claim a venue.
          </p>
        </div>
        {submissions.length > 0 && (
          <span className="text-sm text-gray-500">
            {submissions.length} {submissions.length === 1 ? "submission" : "submissions"}
          </span>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────────── */}
      <div className="border-b border-gray-200 mb-5">
        <nav className="-mb-px flex gap-1">
          {TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <Link
                key={tab.key}
                href={`/control-panel/operator-submissions?tab=${tab.key}`}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? "border-amber-500 text-amber-700"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ── Error state ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────────────────────── */}
      {!error && submissions.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
            <svg
              className="w-6 h-6 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
              />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-slate-900 mb-1">No submissions</h2>
          <p className="text-sm text-gray-500 max-w-xs mx-auto">
            {activeTab === "needs_review"
              ? "No submissions currently need review."
              : activeTab === "confirmed_auto"
              ? "No automatically confirmed submissions yet."
              : "No operator submissions have been received yet."}
          </p>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────────────── */}
      {!error && submissions.length > 0 && (
        <SubmissionsTable
          rows={submissions.map((s) => ({
            ...s,
            submitted: formatDate(s.submitted_at),
          }))}
        />
      )}

      {/* ── Legend ─────────────────────────────────────────────────────────────── */}
      {!error && submissions.length > 0 && (
        <p className="mt-3 text-xs text-gray-400">
          Trust dots (left→right): domain matches website · business email · role level.
          Green = positive, red = negative, grey = unknown.
        </p>
      )}
    </div>
  );
}
