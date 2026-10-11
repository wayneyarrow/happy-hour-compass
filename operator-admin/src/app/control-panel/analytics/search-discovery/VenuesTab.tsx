import Link from "next/link";
import {
  buildItemVenueMap,
  countVenueViews,
  listPublishedVenues,
  loadDiscoveryRows,
  loadLegacyDiscovery,
  legacyRailLabel,
  resolveNames,
} from "@/lib/data/searchDiscoveryReport";
import {
  aggregateLegacyRails,
  aggregateVenueBreakdown,
  aggregateVenueOverview,
  type ItemPerf,
  type LegacyRailStat,
  type VenueBreakdownRow,
  type VenueOverviewRow,
} from "@/lib/searchDiscoveryReporting/placementMetrics";
import { hrefFor, type ReportParams } from "./context";
import { ITEM_TYPE_LABELS, placementLabel, venueName } from "./labels";
import { Empty, Kpi, Note, PositionHelp, SectionHeader, Table, fmt, formatRate, type Col } from "./ui";
import VenueCombobox from "./VenueCombobox";

export default async function VenuesTab({ p, since, until }: { p: ReportParams; since: string | null; until: string }) {
  const [venues, venueViews] = await Promise.all([listPublishedVenues(), p.venue ? countVenueViews(p.venue, since, until) : Promise.resolve(null)]);
  if (p.source === "legacy") return LegacyVenues({ p, since, until, venues });

  const rows = await loadDiscoveryRows(p.source, since, until);
  const itemIds = (type: string) => rows.filter((r) => r.item_type === type && r.item_id).map((r) => r.item_id as string);
  const names = await resolveNames({
    sectionIds: rows.flatMap((r) => (r.section_id ? [r.section_id] : [])),
    guideIds: rows.flatMap((r) => (r.guide_id ? [r.guide_id] : [])),
    venueIds: [...itemIds("venue"), ...(p.venue ? [p.venue] : [])],
    eventIds: itemIds("event"),
    specialIds: itemIds("daily_special"),
  });
  const itemVenue = buildItemVenueMap(names);
  const overview = aggregateVenueOverview(rows, itemVenue);
  const breakdown = p.venue ? aggregateVenueBreakdown(rows, p.venue, itemVenue) : [];

  const perfCells = (prefix: string, get: (o: VenueOverviewRow) => ItemPerf): Col<VenueOverviewRow>[] => [
    { key: `${prefix}i`, label: `${prefix} impr.`, align: "right", render: (o) => fmt(get(o).impressions) },
    { key: `${prefix}c`, label: `${prefix} clicks`, align: "right", render: (o) => fmt(get(o).rawClicks) },
    { key: `${prefix}r`, label: `${prefix} CTR`, align: "right", render: (o) => formatRate(get(o).ctr) },
  ];
  const overviewCols: Col<VenueOverviewRow>[] = [
    {
      key: "v",
      label: "Venue",
      render: (o) => (
        <Link href={hrefFor(p, { venue: o.venueId })} className="font-medium text-slate-900 underline-offset-2 hover:underline">
          {venueName(names, o.venueId)}
        </Link>
      ),
    },
    ...perfCells("Venue card", (o) => o.venueCards),
    ...perfCells("Special card", (o) => o.specialCards),
    ...perfCells("Event card", (o) => o.eventCards),
    { key: "sug", label: "Hero suggestion picks", align: "right", render: (o) => fmt(o.suggestionSelects) },
  ];
  const breakdownCols: Col<VenueBreakdownRow>[] = [
    { key: "src", label: "Source", render: (b) => placementLabel(names, b.placementKey) },
    { key: "t", label: "Card", render: (b) => ITEM_TYPE_LABELS[b.itemType] ?? b.itemType },
    { key: "p", label: "Position", align: "right", render: (b) => (b.position === null ? "—" : `#${b.position + 1}`) },
    { key: "imp", label: "Impressions", align: "right", render: (b) => fmt(b.impressions) },
    { key: "raw", label: "Raw clicks", align: "right", render: (b) => fmt(b.rawClicks) },
    { key: "m", label: "Clicked impressions", align: "right", render: (b) => fmt(b.matchedClicked) },
    { key: "ctr", label: "Item CTR", align: "right", render: (b) => formatRate(b.ctr) },
    { key: "un", label: "Unmatched clicks", align: "right", render: (b) => fmt(b.unmatchedClicks) },
  ];
  const totals = breakdown.reduce(
    (a, b) => ({ imp: a.imp + b.impressions, raw: a.raw + b.rawClicks, m: a.m + b.matchedClicked }),
    { imp: 0, raw: 0, m: 0 }
  );

  return (
    <div>
      <VenuePicker p={p} venues={venues} activeIds={overview.map((o) => o.venueId)} />
      {p.venue && (
        <div className="mb-8 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <h2 className="text-base font-semibold text-slate-900 mb-3">{venueName(names, p.venue)}</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Kpi label="Card impressions" value={fmt(totals.imp)} sub="Visible, all placements" />
            <Kpi label="Raw card clicks" value={fmt(totals.raw)} sub="Incl. hero suggestion picks" />
            <Kpi label="Item CTR" value={formatRate(totals.imp ? totals.m / totals.imp : null)} sub="Clicked impressions ÷ impressions" />
            <Kpi label="Venue page views" value={fmt(venueViews)} sub="All sources · production + legacy" />
          </div>
          <div className="mb-4">
            <Note>
              Venue page views count every view of this venue&apos;s page in the range — from any source, not only discovery — using
              production rows plus legacy rows whose environment is unknown (before Oct 10, 2026 some staging traffic is included and
              can&apos;t be separated). They are shown for context only: this report does not attribute views to placements or claim any
              lift.
            </Note>
            <div className="mt-2">
              <PositionHelp />
            </div>
          </div>
          {breakdown.length === 0 ? (
            <Empty title="No discovery activity for this venue in this range">It may not be placed on the homepage or in a guide yet.</Empty>
          ) : (
            <Table cols={breakdownCols} rows={breakdown} rowKey={(b) => `${b.placementKey}|${b.itemType}|${b.position}`} caption="Venue discovery breakdown" />
          )}
        </div>
      )}
      <SectionHeader
        title="All venues with discovery activity"
        description="Visible card impressions and clicks on the homepage and in guides, by card type. Guides opened are not venue discovery."
      />
      {overview.length === 0 ? (
        <Empty title="No venue discovery activity in this range" />
      ) : (
        <Table cols={overviewCols} rows={overview} rowKey={(o) => o.venueId} caption="Venue discovery overview" />
      )}
    </div>
  );
}

function VenuePicker({ p, venues, activeIds }: { p: ReportParams; venues: { id: string; name: string }[]; activeIds: string[] }) {
  const active = new Set(activeIds);
  const selected = p.venue ? venues.find((v) => v.id === p.venue) ?? { id: p.venue, name: "Selected venue" } : null;
  const baseHref = hrefFor(p, { venue: null });
  return (
    <VenueCombobox
      venues={venues.map((v) => ({ id: v.id, name: v.name, active: active.has(v.id) }))}
      selected={selected}
      baseHref={baseHref}
      clearHref={baseHref}
    />
  );
}

async function LegacyVenues({ p, since, until, venues }: { p: ReportParams; since: string | null; until: string; venues: { id: string; name: string }[] }) {
  if (!p.venue) {
    return (
      <div>
        <VenuePicker p={p} venues={venues} activeIds={[]} />
        <Empty title="Pick a venue to see its legacy discovery">Legacy rows are load-based and mixed-environment; they are shown per venue only.</Empty>
      </div>
    );
  }
  const legacy = await loadLegacyDiscovery(since, until, p.venue);
  const rails = aggregateLegacyRails(legacy.loadCounts, legacy.clicks);
  const names = await resolveNames({
    venueIds: [p.venue],
    sectionIds: rails.flatMap((r) => (r.railName.startsWith("homepage_") ? [r.railName.slice(r.railName.indexOf(":") + 1)] : [])).filter((id) => /^[0-9a-f-]{36}$/.test(id)),
    guideSlugs: rails.flatMap((r) => (r.railName.startsWith("guide:") ? [r.railName.slice(6)] : [])),
  });
  const cols: Col<LegacyRailStat>[] = [
    { key: "r", label: "Legacy rail", render: (r) => legacyRailLabel(r.railName, names) },
    { key: "l", label: "Load rows", align: "right", render: (r) => fmt(r.loadRows) },
    { key: "c", label: "Clicks", align: "right", render: (r) => fmt(r.clicks) },
    { key: "s", label: "Click sessions", align: "right", render: (r) => fmt(r.clickSessions) },
  ];
  return (
    <div>
      <VenuePicker p={p} venues={venues} activeIds={[]} />
      <h2 className="text-base font-semibold text-slate-900 mb-3">{venueName(names, p.venue)} — legacy</h2>
      <div className="mb-4">
        <Note tone="warn">
          <strong>Legacy / mixed traffic — load-based.</strong> Load rows were written when a rail rendered, not when the card was seen,
          so no CTR is shown. Never add these to the visible-impression figures in the Production view.
        </Note>
      </div>
      {rails.length === 0 ? <Empty title="No legacy rows for this venue in this range" /> : <Table cols={cols} rows={rails} rowKey={(r) => r.railName} caption="Legacy rails for venue" />}
    </div>
  );
}
