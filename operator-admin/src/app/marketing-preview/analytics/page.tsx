import type { Metadata } from "next";
import { PLAN_LABELS, ANALYTICS_TIER_LABELS } from "@/lib/plans";
import type { MostViewedEvent } from "@/lib/data/operatorAnalyticsV2";

/**
 * Isolated, static preview of the Operator Admin Premium Plan Analytics
 * page (src/app/admin/analytics/page.tsx), built solely to capture the
 * "See Your Results" screenshot for the public For Businesses page
 * (app/(website)/business/content.tsx). Not linked from anywhere in the
 * app; safe to delete this whole directory once that screenshot exists.
 *
 * Faithfully reproduces layout, card structure, typography, and labels
 * from the real analytics page rather than importing its components —
 * those are private to that page's file, and extracting them into a
 * shared module for one screenshot isn't worth coupling the real page to
 * a throwaway preview. Data below is fixed sample data for a fictional
 * venue ("The Lantern & Oak", premium plan — every card unlocked, so the
 * real page's locked-card/upgrade-note states never render here and
 * aren't reproduced). No Supabase client, no auth, no network calls.
 */

export const metadata: Metadata = {
  title: "Analytics Preview",
  robots: { index: false, follow: false },
};

const SAMPLE_DATA = {
  venueViews: 1284,
  eventViews: 318,
  discoverImpressions: 8741,
  discoverClicks: 276,
  saves: 94,
  mostViewedEvent: { title: "Trivia Tuesday", views: 187 } satisfies MostViewedEvent,
  topSearchTag: "Happy Hour",
  websiteClicks: 121,
  menuClicks: 86,
  hhScheduleExpands: 402,
  businessHoursExpands: 215,
};

function PlanTierBadge() {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap bg-blue-100 text-blue-700">
      {PLAN_LABELS.premium} plan &mdash; {ANALYTICS_TIER_LABELS.advanced}
    </span>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-500 mt-0.5">{description}</p>
      </div>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: number | string;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1 p-5 bg-white rounded-xl border border-gray-200 shadow-raised">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        {label}
      </span>
      <span className="text-3xl font-bold text-gray-900 tabular-nums leading-tight mt-1">
        {value}
      </span>
      {note && (
        <span className="text-xs text-gray-400 mt-0.5 leading-snug">
          {note}
        </span>
      )}
    </div>
  );
}

function MostViewedEventCard({ event }: { event: MostViewedEvent }) {
  return (
    <div className="flex flex-col gap-1 p-5 bg-white rounded-xl border border-gray-200 shadow-raised">
      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
        Most Viewed Event
      </span>
      <span className="text-sm font-semibold text-gray-900 leading-snug mt-1 line-clamp-2">
        {event.title}
      </span>
      <span className="text-xs text-gray-400 mt-0.5">
        {event.views.toLocaleString()} view{event.views !== 1 ? "s" : ""} &middot; Last 30 days
      </span>
    </div>
  );
}

export default function AnalyticsMarketingPreviewPage() {
  const data = SAMPLE_DATA;

  return (
    <div className="min-h-screen bg-slate-100 p-6 md:p-8">
      <div className="max-w-2xl">
        {/* Page heading */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-1.5">
            <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
            <PlanTierBadge />
          </div>
          <p className="text-sm text-gray-500">
            See how Happy Hour Compass is helping consumers discover and engage with your venue.
          </p>
        </div>

        <div className="space-y-4">
          {/* ── Section 1: Visibility ──────────────────────────────────── */}
          <SectionCard
            title="Visibility"
            description="How often consumers are seeing your venue, last 30 days."
          >
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Venue Views" value={data.venueViews} />
              <StatCard label="Event Views" value={data.eventViews} />
              <StatCard label="Discover Impressions" value={data.discoverImpressions} />
              <StatCard label="Discover Clicks" value={data.discoverClicks} />
            </div>
          </SectionCard>

          {/* ── Section 2: Engagement ──────────────────────────────────── */}
          <SectionCard
            title="Engagement"
            description="How consumers are interacting with your venue and events, last 30 days."
          >
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Saves" value={data.saves} />
              <MostViewedEventCard event={data.mostViewedEvent} />
              <StatCard
                label="Top Search Tag"
                value={data.topSearchTag}
                note="Most searched, last 30 days"
              />
            </div>
          </SectionCard>

          {/* ── Section 3: Intent ────────────────────────────────────────── */}
          <SectionCard
            title="Intent"
            description="Actions consumers take when they are interested, last 30 days."
          >
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Website Clicks" value={data.websiteClicks} />
              <StatCard label="Menu Clicks" value={data.menuClicks} />
              <StatCard label="Happy Hour Schedule Expands" value={data.hhScheduleExpands} />
              <StatCard label="Business Hours Expands" value={data.businessHoursExpands} />
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
