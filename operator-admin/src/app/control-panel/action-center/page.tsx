export const dynamic = "force-dynamic";
export const metadata = { title: "Action Center" };

import Link from "next/link";
import { getActionCenterSummary } from "@/lib/data/actionCenter";

// ── Report definitions ────────────────────────────────────────────────────────

const REPORTS = [
  {
    key:         "seededNeedingClaims" as const,
    href:        "/control-panel/action-center/reports/seeded-needing-claims",
    name:        "Seeded Venues Needing Claims",
    description: "Seeded inventory with no operator attached. High-demand venues here are conversion opportunities.",
    priority:    "medium",
  },
  {
    key:         "activeStillOnboarding" as const,
    href:        "/control-panel/action-center/reports/active-still-onboarding",
    name:        "Active Venues Still Onboarding",
    description: "Operators who haven't reached Venue HQ yet. Help them complete setup.",
    priority:    "high",
  },
  {
    key:         "inactiveOperators" as const,
    href:        "/control-panel/action-center/reports/inactive-operators",
    name:        "Inactive Operators",
    description: "Operators not seen in 30+ days. Venues at risk of abandonment.",
    priority:    "high",
  },
  {
    key:         "unpublishedVenues" as const,
    href:        "/control-panel/action-center/reports/unpublished-venues",
    name:        "Unpublished Venues",
    description: "Venues blocked from consumer visibility. Nearly-complete venues should be fixed quickly.",
    priority:    "medium",
  },
  {
    key:         "upgradeOpportunities" as const,
    href:        "/control-panel/action-center/reports/upgrade-opportunities",
    name:        "Upgrade Opportunities",
    description: "Published venues with high setup scores that have hit a Free or Pro plan limit.",
    priority:    "medium",
  },
  {
    key:         "highDemandVenues" as const,
    href:        "/control-panel/action-center/reports/high-demand-venues",
    name:        "High Demand Venues",
    description: "Venues generating significant consumer interest in the last 30 days.",
    priority:    "low",
  },
  {
    key:         "upcomingHighDemandEvents" as const,
    href:        "/control-panel/action-center/reports/high-demand-events",
    name:        "Upcoming High Demand Events",
    description: "Future events already generating strong consumer views. Promote or feature them.",
    priority:    "low",
  },
  {
    key:         "verifiedWithoutOperators" as const,
    href:        "/control-panel/action-center/reports/verified-no-operator",
    name:        "Verified Venues Without Operators",
    description: "Verified venues with no operator attached — a lifecycle leak to investigate.",
    priority:    "medium",
  },
] as const;

type ReportKey = (typeof REPORTS)[number]["key"];

const PRIORITY_STYLES: Record<string, { dot: string; label: string; pill: string }> = {
  high:   { dot: "bg-red-400",    label: "High",   pill: "bg-red-50 text-red-600" },
  medium: { dot: "bg-amber-400",  label: "Medium", pill: "bg-amber-50 text-amber-700" },
  low:    { dot: "bg-green-400",  label: "Low",    pill: "bg-green-50 text-green-700" },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ActionCenterPage() {
  const summary = await getActionCenterSummary();

  return (
    <div className="max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Action Center</h1>
        <p className="mt-1 text-sm text-gray-500">
          Operational work queues for HHC staff. Each report answers: <em>what should we do next?</em>
        </p>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {REPORTS.map((report) => {
          const count = summary[report.key as ReportKey];
          const { dot, label, pill } = PRIORITY_STYLES[report.priority];
          return (
            <div
              key={report.key}
              className="bg-white rounded-xl border border-gray-200 shadow-resting p-5 flex flex-col"
            >
              {/* Priority badge */}
              <div className="flex items-center justify-between mb-3">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${pill}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                  {label}
                </span>
              </div>

              {/* Count */}
              <p className="text-4xl font-bold text-slate-900 leading-none mb-2 tabular-nums">
                {count.toLocaleString()}
              </p>

              {/* Name */}
              <p className="text-sm font-semibold text-slate-800 mb-1.5">{report.name}</p>

              {/* Description */}
              <p className="text-xs text-gray-500 flex-1 mb-4 leading-relaxed">
                {report.description}
              </p>

              {/* CTA */}
              <Link
                href={report.href}
                className="text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors"
              >
                View Report →
              </Link>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <p className="mt-8 text-xs text-gray-400">
        Counts refresh on page load. View counts use a 30-day rolling window.
        Health Score measures setup completion only (not activity or demand).
      </p>
    </div>
  );
}
