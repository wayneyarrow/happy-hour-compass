export const dynamic = "force-dynamic";
export const metadata = { title: "Search & Discovery — Analytics" };

import Link from "next/link";
import type { ReactNode } from "react";
import { getCollectionStarts, IncompleteReadError, ReportTooLargeError, type CollectionStarts } from "@/lib/data/searchDiscoveryReport";
import {
  RANGE_PRESETS,
  RELEASE_QA_SESSION_IDS,
  formatVancouverDate,
  formatVancouverDateTime,
  resolveRange,
} from "@/lib/searchDiscoveryReporting/config";
import { REPORT_TABS, hrefFor, parseParams, type ReportParams } from "./context";
import { AnalyticsTabs, ErrorPanel, Note, Pills } from "./ui";
import SearchTab from "./SearchTab";
import PlacementsTab from "./PlacementsTab";
import GuidesTab from "./GuidesTab";
import VenuesTab from "./VenuesTab";
import { requireControlPanelAdmin } from "@/lib/requireControlPanelAdmin";

/**
 * Founder Control Panel → Analytics → Search & Discovery.
 *
 * Authorization: the Control Panel layout (control-panel/layout.tsx) admits
 * only CP-admin allowlisted users; every query here runs server-side with
 * the service-role client. Metric definitions:
 * docs/analytics/SEARCH_DISCOVERY_TRACKING.md ("Reporting" section).
 */

const SOURCE_LABELS: Record<ReportParams["source"], string> = {
  production: "Production",
  staging: "Staging (QA)",
  legacy: "Legacy / mixed",
};

export default async function SearchDiscoveryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Authorize before any data read or render — see requireControlPanelAdmin.ts.
  await requireControlPanelAdmin();

  const p = parseParams(await searchParams);
  const now = new Date();

  let starts: CollectionStarts = { tracking: { search: null, discovery: null }, firstQualifying: { search: null, discovery: null } };
  let startError: string | null = null;
  try {
    starts = await getCollectionStarts(p.source);
  } catch (e) {
    startError = e instanceof Error ? e.message : String(e);
  }
  const view = p.tab === "search" ? "search" : "discovery";
  const trackingStart = starts.tracking[view];
  const firstQualifying = starts.firstQualifying[view];
  // "All available" starts when tracking began; nothing qualifying exists before the first qualifying event anyway.
  const { since, until } = resolveRange(p.range, now, trackingStart);

  let body: ReactNode;
  if (startError) {
    body = <ErrorPanel message={startError} />;
  } else if (!trackingStart) {
    body = (
      <Note>
        No {view} events have been recorded for the {SOURCE_LABELS[p.source]} source yet
        {p.source === "legacy" ? "." : " — the new tracking hasn't written any rows for this environment."}
      </Note>
    );
  } else {
    try {
      // Tabs are async Server Components with no hooks; awaiting them here
      // means a loader error (incomplete read, range too large) is caught
      // and shown instead of partial totals or a crashed page.
      const props = { p, since, until };
      body =
        p.tab === "search" ? await SearchTab(props)
        : p.tab === "placements" ? await PlacementsTab(props)
        : p.tab === "guides" ? await GuidesTab(props)
        : await VenuesTab(props);
    } catch (e) {
      const message =
        e instanceof ReportTooLargeError || e instanceof IncompleteReadError ? e.message : `Unexpected error: ${e instanceof Error ? e.message : String(e)}`;
      body = <ErrorPanel message={message} />;
    }
  }

  return (
    <div className="max-w-6xl">
      <AnalyticsTabs active="search-discovery" />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Search &amp; Discovery</h1>
          <p className="mt-1 text-sm text-gray-500">What visitors search for, and which homepage sections, positions and guides drive discovery.</p>
        </div>
        <p className="text-xs text-gray-400 pt-1">Data as of {formatVancouverDateTime(until)} (Vancouver)</p>
      </div>

      <nav aria-label="Report sections" className="mb-4 flex flex-wrap gap-1.5">
        {REPORT_TABS.map((t) => (
          <Link
            key={t.value}
            href={hrefFor(p, { tab: t.value, section: null, guide: null })}
            aria-current={p.tab === t.value ? "page" : undefined}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${p.tab === t.value ? "bg-slate-900 text-white" : "bg-white border border-gray-200 text-gray-600 hover:border-gray-300"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mb-4 flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3">
        <Pills
          label="Data"
          options={(["production", "staging", "legacy"] as const).map((s) => ({ label: SOURCE_LABELS[s], href: hrefFor(p, { source: s, section: null, guide: null }), active: p.source === s }))}
        />
        <Pills label="Range" options={RANGE_PRESETS.map((r) => ({ label: r.label, href: hrefFor(p, { range: r.value }), active: p.range === r.value }))} />
      </div>

      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-600">
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <span className="font-semibold text-gray-700">{p.source === "legacy" ? "Legacy data from" : "Tracking started"}:</span>{" "}
          {trackingStart ? formatVancouverDate(trackingStart) : "not yet"}
          <span className="block text-gray-500">
            First qualifying {view === "search" ? "search" : "event"}:{" "}
            {firstQualifying ? formatVancouverDateTime(firstQualifying) : trackingStart ? "none yet (only release-QA rows so far)" : "—"}
          </span>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <span className="font-semibold text-gray-700">Window:</span> {since ? formatVancouverDate(since) : "—"} → {formatVancouverDate(until)}
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2" title={RELEASE_QA_SESSION_IDS.join(", ")}>
          <span className="font-semibold text-gray-700">Excluded:</span> {RELEASE_QA_SESSION_IDS.length} release-QA sessions
          {p.source === "production" ? " · environment = production only" : p.source === "staging" ? " · environment = staging only" : " · legacy rows only"}
        </div>
      </div>

      {body}
    </div>
  );
}
