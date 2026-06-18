import { PLAN_LABELS } from "@/lib/plans";
import type {
  VenueHealthData,
  HealthStatus,
  LifecycleStage,
  OperatorActivityStatus,
  PaidStatus,
} from "@/lib/data/venueHealth";

/**
 * Right-column Health Panel for the Control Panel venue detail page
 * (/control-panel/venues/[id]). Pure presentational component — all data is
 * computed by src/lib/data/venueHealth.ts.
 */

// ── Shared local styles (mirrors Section/MetaRow in page.tsx) ─────────────────

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm py-1">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-800 text-right min-w-0">{children}</span>
    </div>
  );
}

function NotAvailable() {
  return <span className="text-gray-400 italic">Not available</span>;
}

function ComingSoon() {
  return <span className="text-gray-400 italic">Coming soon</span>;
}

function YesNo({ value }: { value: boolean }) {
  return value ? (
    <span className="text-green-700 font-medium">Yes</span>
  ) : (
    <span className="text-gray-500">No</span>
  );
}

// ── Status badge palettes ───────────────────────────────────────────────────

const HEALTH_BADGE: Record<HealthStatus, { label: string; classes: string }> = {
  healthy:         { label: "Healthy",          classes: "bg-green-50 text-green-700 border border-green-200" },
  needs_attention: { label: "Needs Attention",  classes: "bg-amber-50 text-amber-700 border border-amber-200" },
  at_risk:         { label: "At Risk",          classes: "bg-red-50 text-red-700 border border-red-200" },
};

const LIFECYCLE_LABEL: Record<LifecycleStage, string> = {
  onboarding_complete: "Onboarding Complete",
  still_onboarding:    "Still Onboarding",
  not_active:          "Not Active",
};

const ACTIVITY_BADGE: Record<OperatorActivityStatus, { label: string; classes: string }> = {
  active:           { label: "Active",           classes: "bg-green-50 text-green-700 border border-green-200" },
  inactive:         { label: "Inactive",          classes: "bg-amber-50 text-amber-700 border border-amber-200" },
  dormant:          { label: "Dormant",           classes: "bg-red-50 text-red-700 border border-red-200" },
  never_logged_in:  { label: "Never Logged In",   classes: "bg-gray-100 text-gray-600 border border-gray-300" },
  not_active:       { label: "Not Active",        classes: "bg-gray-100 text-gray-500 border border-gray-300" },
};

const PLAN_BADGE: Record<string, string> = {
  enterprise: "bg-purple-100 text-purple-700 border border-purple-300",
  premium:    "bg-amber-100  text-amber-700  border border-amber-300",
  pro:        "bg-sky-100    text-sky-700    border border-sky-300",
  free:       "bg-gray-100   text-gray-500   border border-gray-300",
};

const PAID_STATUS_LABEL: Record<PaidStatus, string> = {
  free:       "Free",
  paid:       "Paid",
  not_active: "Not Active",
};

const SOURCE_LABEL: Record<string, string> = {
  seed:                 "Seed",
  operator_submission:  "Operator Submission",
  consumer_suggestion:  "Consumer Suggestion",
  internal:             "Internal",
};

function Badge({ label, classes }: { label: string; classes: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes}`}>
      {label}
    </span>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function VenueHealthPanel({ data }: { data: VenueHealthData }) {
  const health = HEALTH_BADGE[data.setupStatus];
  const activity = ACTIVITY_BADGE[data.operatorActivityStatus];
  const planBadgeClasses = data.plan ? (PLAN_BADGE[data.plan] ?? PLAN_BADGE.free) : null;

  return (
    <div className="lg:sticky lg:top-6 space-y-5">

      {/* 1. Venue Health — Setup Health Score */}
      <Card title="Venue Health" subtitle="Setup Health Score">
        <div className="flex items-center justify-between">
          <p className="text-3xl font-bold text-slate-900 leading-none">
            {data.setupHealthScorePct}%
          </p>
          <Badge label={health.label} classes={health.classes} />
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Based on required setup items ({data.setupCompletedCount} of {data.setupTotalCount} complete).
        </p>
      </Card>

      {/* 2. Lifecycle */}
      <Card title="Lifecycle">
        <div className="divide-y divide-gray-100">
          <Row label="Source">
            {data.source ? (SOURCE_LABEL[data.source] ?? data.source) : <NotAvailable />}
          </Row>
          <Row label="Verified"><YesNo value={data.isVerified} /></Row>
          <Row label="Active"><YesNo value={data.isActive} /></Row>
          <Row label="Onboarding">{LIFECYCLE_LABEL[data.lifecycleStage]}</Row>
          <Row label="Current Plan">
            {data.plan ? (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${planBadgeClasses}`}>
                {PLAN_LABELS[data.plan]}
              </span>
            ) : (
              <NotAvailable />
            )}
          </Row>
          <Row label="Published"><YesNo value={data.isPublished} /></Row>
          {/* venueUpdatedAt may eventually support stale-listing reports, Action Center
              work-queue entries, operator nudges, and venue health scoring improvements. */}
          <Row label="Last Updated">{fmtRelative(data.venueUpdatedAt)}</Row>
        </div>
      </Card>

      {/* 3. Setup Status */}
      <Card title="Setup Status" subtitle="Required setup items">
        <ul className="space-y-1.5">
          {data.setupChecklist.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-sm">
              {item.completed ? (
                <span className="text-green-600">✓</span>
              ) : (
                <span className="text-amber-600">⚠</span>
              )}
              <span className={item.completed ? "text-gray-700" : "text-gray-500"}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* 4. Operator Activity — kept separate from the Health Score above */}
      <Card title="Operator Activity">
        <div className="divide-y divide-gray-100">
          <Row label="Last seen">{fmtDate(data.operatorLastSeenAt)}</Row>
          <Row label="Status"><Badge label={activity.label} classes={activity.classes} /></Row>
          <Row label="Team members">
            {data.teamMembersCount != null ? data.teamMembersCount : <NotAvailable />}
          </Row>
          <Row label="Operator">
            {data.operatorName || data.operatorEmail ? (
              <span className="block truncate max-w-[180px]" title={data.operatorEmail ?? undefined}>
                {data.operatorName ?? data.operatorEmail}
              </span>
            ) : (
              <NotAvailable />
            )}
          </Row>
        </div>
      </Card>

      {/* 5. Consumer Demand */}
      <Card title="Consumer Demand">
        <div className="divide-y divide-gray-100">
          <Row label="Venue views (30d)">{data.venueViews30d.toLocaleString()}</Row>
          <Row label="Venue views (7d)">{data.venueViews7d.toLocaleString()}</Row>
          <Row label="Event views (30d)">{data.eventViews30d.toLocaleString()}</Row>
          <Row label="Top event">
            {data.topEventLabel ? (
              <span className="block truncate max-w-[180px]" title={data.topEventLabel}>
                {data.topEventLabel} ({data.topEventViews})
              </span>
            ) : (
              <NotAvailable />
            )}
          </Row>
        </div>
      </Card>

      {/* 6. Monetization */}
      <Card title="Monetization">
        <div className="divide-y divide-gray-100">
          <Row label="Current Plan">
            {data.plan ? (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${planBadgeClasses}`}>
                {PLAN_LABELS[data.plan]}
              </span>
            ) : (
              <NotAvailable />
            )}
          </Row>
          <Row label="Paid Status">{PAID_STATUS_LABEL[data.paidStatus]}</Row>
          <Row label="Upgrade Opportunity">
            {data.upgradeOpportunity == null ? "Not evaluated" : data.upgradeOpportunity ? "Yes" : "No"}
          </Row>
          {/* TODO: replace these placeholders once Stripe-powered revenue
              analytics lands. Do not hard-code revenue numbers until then. */}
          <Row label="MRR"><ComingSoon /></Row>
          <Row label="Revenue (Last 365 Days)"><ComingSoon /></Row>
          <Row label="Lifetime Revenue"><ComingSoon /></Row>
        </div>
      </Card>

    </div>
  );
}
