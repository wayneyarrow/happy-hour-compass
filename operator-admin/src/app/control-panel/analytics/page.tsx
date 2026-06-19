export const dynamic = "force-dynamic";
export const metadata = { title: "Platform Analytics" };

import {
  getFounderDashboardData,
  type TopItem,
  type SetupItemCount,
  type ConversionRate,
} from "@/lib/data/founderDashboard";

// ── Status level ───────────────────────────────────────────────────────────────

type StatusLevel = "healthy" | "watch" | "action";

const STATUS_DOT: Record<StatusLevel, string> = {
  healthy: "bg-green-500",
  watch:   "bg-yellow-400",
  action:  "bg-red-500",
};

const STATUS_TEXT: Record<StatusLevel, string> = {
  healthy: "Healthy",
  watch:   "Watch",
  action:  "Act Now",
};

const STATUS_PILL: Record<StatusLevel, string> = {
  healthy: "bg-green-50 text-green-700",
  watch:   "bg-yellow-50 text-yellow-700",
  action:  "bg-red-50 text-red-700",
};

function rateStatus(
  pct: number,
  thresholds: { healthy: number; watch: number }
): StatusLevel {
  if (pct >= thresholds.healthy) return "healthy";
  if (pct >= thresholds.watch)   return "watch";
  return "action";
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: StatusLevel }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_PILL[status]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
      {STATUS_TEXT[status]}
    </span>
  );
}

function KpiCard({
  label,
  value,
  subtext,
  trend,
}: {
  label: string;
  value: number | string;
  subtext?: string;
  trend?: number;
}) {
  const display = typeof value === "number" ? value.toLocaleString() : value;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-raised p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
        {label}
      </p>
      <p className="text-3xl font-bold text-gray-900 leading-none">{display}</p>
      {subtext && <p className="mt-1.5 text-xs text-gray-400">{subtext}</p>}
      {typeof trend === "number" && trend > 0 && (
        <span className="mt-2 inline-block text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
          +{trend.toLocaleString()} last 30d
        </span>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="mt-0.5 text-sm text-gray-500">{description}</p>
    </div>
  );
}

function ConversionRow({
  label,
  rate,
  thresholds,
  note,
}: {
  label: string;
  rate: ConversionRate;
  thresholds: { healthy: number; watch: number };
  note?: string;
}) {
  const { numerator, denominator } = rate;
  const pct = denominator > 0 ? (numerator / denominator) * 100 : null;
  const status = pct !== null ? rateStatus(pct, thresholds) : null;

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <div>
        <span className="text-sm text-gray-700">{label}</span>
        {note && <p className="text-xs text-gray-400 mt-0.5">{note}</p>}
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-4">
        {pct !== null ? (
          <>
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {pct.toFixed(1)}%
            </span>
            {status && <StatusBadge status={status} />}
          </>
        ) : (
          <span className="text-xs text-gray-400">No data</span>
        )}
      </div>
    </div>
  );
}

function LeaderboardTable({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: TopItem[];
  emptyText: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 italic">{emptyText}</p>
      ) : (
        <ol className="space-y-2.5">
          {items.map((item, idx) => (
            <li key={item.id} className="flex items-center justify-between text-sm gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-4 shrink-0 text-xs font-mono text-gray-400 text-right">
                  {idx + 1}.
                </span>
                <span className="truncate text-slate-700">{item.label}</span>
              </div>
              <span className="shrink-0 tabular-nums text-xs font-medium text-gray-500">
                {item.views.toLocaleString()} views
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MissingItemsList({ items }: { items: SetupItemCount[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4 bg-white rounded-xl border border-gray-200 shadow-resting p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
        Top Missing Setup Items — Active Venues Still Onboarding
      </p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.label} className="flex items-center justify-between text-sm">
            <span className="text-gray-600">{item.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">
              {item.count.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC";
  } catch {
    return iso;
  }
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default async function PlatformAnalyticsPage() {
  const d = await getFounderDashboardData();
  const { acquisition: acq, activation: act, monetization: mon, consumerDemand: cd } = d;

  const monetizationRatePct =
    mon.monetizationRate.denominator > 0
      ? (mon.monetizationRate.numerator / mon.monetizationRate.denominator) * 100
      : null;

  return (
    <div className="max-w-5xl">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Platform Analytics</h1>
          <p className="mt-1 text-sm text-gray-500">Platform-wide metrics — acquisition, activation, monetization, and consumer demand.</p>
        </div>
        <p className="text-xs text-gray-400 pt-1 shrink-0 ml-6">
          Fetched {formatTimestamp(d.fetchedAt)}
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          A — ACQUISITION
         ══════════════════════════════════════════════════════════════════════ */}
      <div className="mb-10">
        <SectionHeader
          title="A — Acquisition"
          description="Are we acquiring venue opportunities?"
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <KpiCard
            label="Suggested Venues"
            value={acq.suggestedVenues}
            subtext="venue_suggestions, all time"
            trend={acq.newSuggestedVenues30d}
          />
          <KpiCard
            label="Submitted Venues"
            value={acq.submittedVenues}
            subtext="operator_submissions, all time"
            trend={acq.newSubmittedVenues30d}
          />
          <KpiCard
            label="Seeded Venues"
            value={acq.seededVenues}
            subtext="source = seed"
            trend={acq.newSeededVenues30d}
          />
          <KpiCard
            label="Claimed Venues"
            value={acq.claimedVenues}
            subtext="claimed_at set"
            trend={acq.newClaimedVenues30d}
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-resting px-5 py-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-4 pb-2">
            Conversion
          </p>
          <ConversionRow
            label="Seed → Claim"
            rate={acq.seedToClaim}
            thresholds={{ healthy: 15, watch: 8 }}
            note="Seeded-and-claimed venues / seeded venues"
          />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          B — ACTIVATION
         ══════════════════════════════════════════════════════════════════════ */}
      <div className="mb-10 pt-8 border-t border-gray-200">
        <SectionHeader
          title="B — Activation"
          description="Are verified venues becoming active and completing setup — and are operators coming back?"
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <KpiCard
            label="Verified Venues"
            value={act.verifiedVenues}
            subtext="Claim or submission approved"
          />
          <KpiCard
            label="Active Venues"
            value={act.activeVenues}
            subtext="Operator attached"
          />
          <KpiCard
            label="Still Onboarding"
            value={act.stillOnboarding}
            subtext="Active venues still seeing setup checklist"
          />
          <KpiCard
            label="Onboarding Complete"
            value={act.onboardingComplete}
            subtext="Active venues seeing Venue HQ"
          />
        </div>

        <MissingItemsList items={act.topMissingSetupItems} />

        <div className="bg-white rounded-xl border border-gray-200 shadow-resting px-5 py-1 mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-4 pb-2">
            Conversion
          </p>
          <ConversionRow
            label="Verified → Active"
            rate={act.verifiedToActive}
            // TODO: these are first-pass thresholds for a brand-new conversion — tune once volume increases.
            thresholds={{ healthy: 50, watch: 25 }}
            note="Active venues / verified venues"
          />
          <ConversionRow
            label="Active → Venue HQ"
            rate={act.activeToVenueHq}
            // TODO: these are first-pass thresholds for a brand-new conversion — tune once volume increases.
            thresholds={{ healthy: 50, watch: 25 }}
            note="Onboarding complete / active venues"
          />
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3 mt-6">
          Operator Usage — Are Operators Coming Back?
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KpiCard
            label="Active Operators (last 30d)"
            value={act.activeOperators}
            subtext="last_seen_at within 30 days"
          />
          <KpiCard
            label="Inactive Operators (30d+)"
            value={act.inactiveOperators}
            subtext="last_seen_at older than 30 days"
          />
          <KpiCard
            label="Never Logged In"
            value={act.neverLoggedInOperators}
            subtext="last_seen_at not set"
          />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          C — MONETIZATION
         ══════════════════════════════════════════════════════════════════════ */}
      <div className="mb-10 pt-8 border-t border-gray-200">
        <SectionHeader
          title="C — Monetization"
          description="Are active venues converting to paid plans? Revenue / MRR not yet calculated."
        />

        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
          Plan Distribution — Active Venues
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <KpiCard label="Free Venues"    value={mon.freeVenues}    subtext="Attached operator plan = free" />
          <KpiCard label="Pro Venues"     value={mon.proVenues}     subtext="Attached operator plan = pro" />
          <KpiCard label="Premium Venues" value={mon.premiumVenues} subtext="Attached operator plan = premium" />
          <KpiCard label="Paid Venues"    value={mon.paidVenues}    subtext="Pro + Premium venues" />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-5 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
            Monetization Rate
          </p>
          <p className="text-3xl font-bold text-gray-900 leading-none">
            {monetizationRatePct !== null ? `${monetizationRatePct.toFixed(1)}%` : "—"}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {mon.monetizationRate.numerator.toLocaleString()} paid venues out of{" "}
            {mon.monetizationRate.denominator.toLocaleString()} seeded/submitted non-churned venues
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Denominator = (Seeded + Submitted) − Churned ({mon.seededVenues.toLocaleString()} seeded
            {" + "}{mon.submittedVenues.toLocaleString()} submitted{" − "}
            {mon.churnedVenuesAllTime.toLocaleString()} churned). Suggested Venues are excluded — a
            suggestion is a lead signal, not inventory yet.
          </p>
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
          Last 30 Days
        </p>
        <div className="grid grid-cols-3 gap-3 mb-6">
          <KpiCard
            label="Upgrades"
            value={mon.upgradesLast30d}
            subtext="Plan rank increased"
          />
          <KpiCard
            label="Downgrades"
            value={mon.downgradesLast30d}
            subtext="Plan rank decreased"
          />
          <KpiCard
            label="Churn"
            value={mon.churnLast30d}
            subtext="Paid → Free"
          />
        </div>
        {mon.upgradesLast30d === 0 && mon.downgradesLast30d === 0 && mon.churnLast30d === 0 && (
          <p className="mb-6 text-xs text-gray-400">
            All zeroes — plan_change_events has no records yet. Counts will populate once plan changes are made.
          </p>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow-resting px-5 py-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-4 pb-2">
            Conversion
          </p>
          <ConversionRow
            label="Claim → Paid"
            rate={mon.claimToPaid}
            thresholds={{ healthy: 25, watch: 10 }}
            note="Paid venues / claimed venues"
          />
          <ConversionRow
            label="Free → Pro"
            rate={mon.freeToPro}
            thresholds={{ healthy: 15, watch: 5 }}
            note="Pro venues / (free + pro venues)"
          />
          <ConversionRow
            label="Pro → Premium"
            rate={mon.proToPremium}
            thresholds={{ healthy: 20, watch: 10 }}
            note="Premium venues / (pro + premium venues)"
          />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          D — CONSUMER DEMAND
         ══════════════════════════════════════════════════════════════════════ */}
      <div className="mb-10 pt-8 border-t border-gray-200">
        <SectionHeader
          title="D — Consumer Demand"
          description="Are consumers engaging? Anonymous page views — session IDs are random UUIDs, no PII stored."
        />

        <div className="grid grid-cols-2 gap-3 mb-6">
          <KpiCard
            label="Venue Views"
            value={cd.venueViewsLast30d}
            subtext="Last 30 days"
          />
          <KpiCard
            label="Event Views"
            value={cd.eventViewsLast30d}
            subtext="Last 30 days"
          />
        </div>

        {cd.venueViewsLast30d === 0 && cd.eventViewsLast30d === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-resting flex flex-col items-center justify-center py-16 px-6 text-center">
            <p className="text-base font-semibold text-gray-700 mb-1">No view data yet</p>
            <p className="text-sm text-gray-400 max-w-xs">
              Data will appear once venue and event detail pages are visited.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LeaderboardTable
              title="Most Viewed Venues — Last 30 Days"
              items={cd.topVenues}
              emptyText="No venue views recorded yet."
            />
            <LeaderboardTable
              title="Most Viewed Events — Last 30 Days"
              items={cd.topEvents}
              emptyText="No event views recorded yet."
            />
          </div>
        )}
      </div>

    </div>
  );
}
