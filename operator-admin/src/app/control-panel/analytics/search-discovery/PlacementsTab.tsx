import Link from "next/link";
import { loadDiscoveryRows, loadLegacyDiscovery, loadLegacyRailLoads, legacyRailLabel, resolveNames } from "@/lib/data/searchDiscoveryReport";
import {
  aggregateHero,
  aggregateLegacyRailDetail,
  aggregateLegacyRails,
  aggregatePlacementItems,
  aggregatePlacementPositions,
  aggregateSections,
  type HeroStat,
  type ItemRow,
  type LegacyRailPositionRow,
  type LegacyRailStat,
  type LegacyRailVenueRow,
  type PositionRow,
  type SectionStat,
} from "@/lib/searchDiscoveryReporting/placementMetrics";
import { hrefFor, type ReportParams } from "./context";
import { ITEM_TYPE_LABELS, SECTION_KIND_ORDER, itemName, sectionKindLabel, sectionTitle, venueName } from "./labels";
import { Badge, Empty, Kpi, Note, PositionHelp, SectionHeader, Table, fmt, formatRate, type Col } from "./ui";

export default async function PlacementsTab({ p, since, until }: { p: ReportParams; since: string | null; until: string }) {
  if (p.source === "legacy") return LegacyPlacements({ p, since, until });
  const rows = await loadDiscoveryRows(p.source, since, until);
  const sections = aggregateSections(rows);
  const homeRows = rows.filter((r) => r.surface === "homepage_section");
  const selectedItems = p.section ? aggregatePlacementItems(rows, `s:${p.section}`) : [];
  const names = await resolveNames({
    sectionIds: [...sections.map((s) => s.sectionId), ...(p.section ? [p.section] : [])],
    venueIds: selectedItems.filter((i) => i.itemType === "venue").map((i) => i.itemId),
    eventIds: selectedItems.filter((i) => i.itemType === "event").map((i) => i.itemId),
    specialIds: selectedItems.filter((i) => i.itemType === "daily_special").map((i) => i.itemId),
    guideIds: selectedItems.filter((i) => i.itemType === "guide").map((i) => i.itemId),
  });

  const pageViews = new Set(homeRows.map((r) => r.page_view_id)).size;
  const sessions = new Set(homeRows.map((r) => r.session_id)).size;

  const sectionCols: Col<SectionStat>[] = [
    {
      key: "title",
      label: "Section",
      render: (s) => {
        const { title, flags } = sectionTitle(names, s.sectionId);
        return (
          <span>
            <Link href={hrefFor(p, { section: s.sectionId })} className="font-medium text-slate-900 underline-offset-2 hover:underline">
              {title}
            </Link>{" "}
            {flags.map((f) => (
              <Badge key={f} tone="amber">{f}</Badge>
            ))}
          </span>
        );
      },
    },
    { key: "exposed", label: "Exposed page views", align: "right", title: "Distinct page views where the section heading was ≥50% visible for ≥1s", render: (s) => fmt(s.exposedPageViews) },
    { key: "imp", label: "Item impressions", align: "right", title: "Distinct visible card impressions (page view + card)", render: (s) => fmt(s.impressions) },
    { key: "clicks", label: "Raw clicks", align: "right", render: (s) => fmt(s.rawClicks) },
    { key: "clickpv", label: "Clicking page views", align: "right", title: "Distinct page views with ≥1 card or View all click in this section", render: (s) => fmt(s.clickingPageViews) },
    { key: "eng", label: "Engagement rate", align: "right", title: "Exposed page views with ≥1 section click ÷ exposed page views", render: (s) => formatRate(s.engagementRate) },
    { key: "ctr", label: "Item CTR", align: "right", title: "Impressions with ≥1 matched click ÷ impressions", render: (s) => formatRate(s.ctr) },
    { key: "unmatched", label: "Unmatched clicks", align: "right", title: "Clicks on a card that wasn't (yet) counted as seen in that page view", render: (s) => fmt(s.unmatchedClicks) },
    { key: "va", label: "View all", align: "right", render: (s) => fmt(s.viewAllClicks) },
    { key: "outside", label: "Clicks w/o exposure", align: "right", title: "Section clicks in page views where the heading never qualified — excluded from engagement rate", render: (s) => fmt(s.clicksOutsideExposure) },
  ];

  const byKind = new Map<string, SectionStat[]>();
  for (const s of sections) {
    const k = s.sectionKind ?? "unknown";
    byKind.set(k, [...(byKind.get(k) ?? []), s]);
  }
  const kindRank = (k: string) => (SECTION_KIND_ORDER.includes(k) ? SECTION_KIND_ORDER.indexOf(k) : SECTION_KIND_ORDER.length);
  const kinds = [...byKind.keys()].sort((a, b) => kindRank(a) - kindRank(b));

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Homepage page views" value={fmt(pageViews)} sub="With ≥1 tracked section event" />
        <Kpi label="Sessions" value={fmt(sessions)} sub="Distinct browser tabs" />
        <Kpi label="Item impressions" value={fmt(sections.reduce((a, s) => a + s.impressions, 0))} />
        <Kpi label="Raw card clicks" value={fmt(sections.reduce((a, s) => a + s.rawClicks, 0))} />
      </div>
      <div className="mb-6">
        <Note>
          Visible tracking only: an impression is a card ≥50% on screen for ≥1 continuous second, counted once per page view. Item CTR =
          impressed cards with ≥1 matched click ÷ impressed cards (a click and impression match within the same page view even if the
          impression qualified after the click). Clicks on cards that were never counted as seen are shown as unmatched, never folded into
          CTR. Page views with no tracked section event (visitors who never scrolled) aren&apos;t counted — there is no page-view event.
        </Note>
        <div className="mt-2">
          <PositionHelp />
        </div>
      </div>

      {sections.length === 0 ? (
        <Empty title="No homepage placement data in this range">Section exposures and impressions appear once visitors scroll the homepage.</Empty>
      ) : (
        kinds.map((k) => (
          <div key={k} className="mb-6">
            <SectionHeader title={sectionKindLabel(k)} />
            <Table cols={sectionCols} rows={byKind.get(k)!.sort((a, b) => b.exposedPageViews - a.exposedPageViews)} rowKey={(s) => s.sectionId} caption={sectionKindLabel(k)} />
          </div>
        ))
      )}

      {p.section && <SectionDetail p={p} rows={rows} names={names} items={selectedItems} />}

      <div className="mt-8">
        <SectionHeader title="Homepage hero" description="Browse button, search suggestion picks and “See all” — events, distinct sessions." />
        <HeroTable stats={aggregateHero(rows)} />
      </div>
    </div>
  );
}

function SectionDetail({
  p,
  rows,
  names,
  items,
}: {
  p: ReportParams;
  rows: Parameters<typeof aggregatePlacementPositions>[0];
  names: Awaited<ReturnType<typeof resolveNames>>;
  items: ItemRow[];
}) {
  const positions = aggregatePlacementPositions(rows, `s:${p.section}`);
  const { title } = sectionTitle(names, p.section!);
  const itemCols: Col<ItemRow>[] = [
    { key: "name", label: "Item", render: (i) => <span className="font-medium text-gray-900">{itemName(names, i.itemType, i.itemId)}</span> },
    { key: "type", label: "Type", render: (i) => ITEM_TYPE_LABELS[i.itemType] ?? i.itemType },
    { key: "pos", label: "Positions", render: (i) => (i.positions.length ? i.positions.map((x) => x + 1).join(", ") : "—") },
    { key: "imp", label: "Impressions", align: "right", render: (i) => fmt(i.impressions) },
    { key: "raw", label: "Raw clicks", align: "right", render: (i) => fmt(i.rawClicks) },
    { key: "matched", label: "Clicked impressions", align: "right", render: (i) => fmt(i.matchedClicked) },
    { key: "ctr", label: "Item CTR", align: "right", render: (i) => formatRate(i.ctr) },
    { key: "un", label: "Unmatched clicks", align: "right", render: (i) => fmt(i.unmatchedClicks) },
  ];
  const posCols: Col<PositionRow>[] = [
    { key: "p", label: "Position", render: (r) => `#${r.position + 1}` },
    { key: "imp", label: "Impressions", align: "right", render: (r) => fmt(r.impressions) },
    { key: "raw", label: "Raw clicks", align: "right", render: (r) => fmt(r.rawClicks) },
    { key: "matched", label: "Clicked impressions", align: "right", render: (r) => fmt(r.matchedClicked) },
    { key: "ctr", label: "Position CTR", align: "right", render: (r) => formatRate(r.ctr) },
    { key: "un", label: "Unmatched clicks", align: "right", render: (r) => fmt(r.unmatchedClicks) },
  ];
  return (
    <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-base font-semibold text-slate-900">Section detail: {title}</h2>
        <Link href={hrefFor(p, { section: null })} className="text-xs text-gray-500 hover:text-gray-700">
          Close ✕
        </Link>
      </div>
      {items.length === 0 ? (
        <Empty title="No item activity for this section in this range" />
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-2">By item. Positions are 1-based as rendered when the impression fired.</p>
          <div className="mb-5">
            <Table cols={itemCols} rows={items} rowKey={(i) => `${i.itemType}:${i.itemId}`} caption="Items in section" />
          </div>
          <p className="text-xs text-gray-500 mb-2">
            By position (impressions by the position they were seen at; clicks by the position clicked).
          </p>
          <Table cols={posCols} rows={positions} rowKey={(r) => String(r.position)} caption="Positions in section" />
        </>
      )}
    </div>
  );
}

const HERO_EVENT_LABELS: Record<string, string> = {
  browse_click: "Browse button",
  suggestion_select: "Search suggestion picked",
  view_all_click: "“See all … matching”",
};
const MODE_LABELS: Record<string, string> = { happy_hours: "Happy Hours", daily_specials: "Daily Specials", events: "Events", unknown: "—" };

function HeroTable({ stats }: { stats: HeroStat[] }) {
  if (stats.length === 0) return <Empty title="No hero interactions in this range" />;
  const cols: Col<HeroStat>[] = [
    { key: "e", label: "Interaction", render: (s) => HERO_EVENT_LABELS[s.eventType] ?? s.eventType },
    { key: "m", label: "Mode", render: (s) => MODE_LABELS[s.mode] ?? s.mode },
    { key: "n", label: "Events", align: "right", render: (s) => fmt(s.events) },
    { key: "s", label: "Sessions", align: "right", render: (s) => fmt(s.sessions) },
  ];
  return <Table cols={cols} rows={stats} rowKey={(s) => `${s.eventType}|${s.mode}`} caption="Homepage hero" />;
}

async function LegacyPlacements({ p, since, until }: { p: ReportParams; since: string | null; until: string }) {
  const legacy = await loadLegacyDiscovery(since, until);
  const rails = aggregateLegacyRails(legacy.loadCounts, legacy.clicks);
  const railLoads = p.rail ? await loadLegacyRailLoads(p.rail, since, until) : [];
  const detail = p.rail ? aggregateLegacyRailDetail(railLoads, legacy.clicks.filter((c) => c.rail_name === p.rail)) : null;
  const names = await resolveNames({
    venueIds: detail?.byVenue.map((v) => v.venueId) ?? [],
    sectionIds: rails.flatMap((r) => (r.railName.startsWith("homepage_") ? [r.railName.slice(r.railName.indexOf(":") + 1)] : [])).filter((id) => /^[0-9a-f-]{36}$/.test(id)),
    guideSlugs: rails.flatMap((r) => (r.railName.startsWith("guide:") ? [r.railName.slice(6)] : [])),
  });
  const cols: Col<LegacyRailStat>[] = [
    {
      key: "rail",
      label: "Legacy rail",
      render: (r) => (
        <Link href={hrefFor(p, { rail: r.railName })} className="font-medium text-slate-900 underline-offset-2 hover:underline">
          {legacyRailLabel(r.railName, names)}
        </Link>
      ),
    },
    { key: "loads", label: "Load rows", align: "right", title: "Impression rows written when the rail rendered — not seen", render: (r) => fmt(r.loadRows) },
    { key: "clicks", label: "Clicks", align: "right", render: (r) => fmt(r.clicks) },
    { key: "cs", label: "Click sessions", align: "right", render: (r) => fmt(r.clickSessions) },
  ];
  return (
    <div>
      <div className="mb-5">
        <Note tone="warn">
          <strong>Legacy / mixed traffic — load-based, not visible impressions.</strong> Before Oct 10, 2026 the website wrote an “impression”
          row for every card when a rail rendered, whether or not anyone scrolled to it, and staging and production traffic were mixed. These
          load rows are not comparable with visible impressions and no CTR is calculated from them. Today&apos;s Specials used one fixed rail
          name and recorded only the venue, not the special.
        </Note>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Load rows" value={fmt(legacy.totalLoadRows)} sub={legacy.unattributedLoadRows ? `${fmt(legacy.unattributedLoadRows)} in unlisted rails` : "All attributed to a rail"} />
        <Kpi label="Clicks" value={fmt(legacy.clicks.length)} />
        <Kpi label="Click sessions" value={fmt(new Set(legacy.clicks.map((c) => c.session_id)).size)} />
        <Kpi label="Rails" value={fmt(rails.length)} />
      </div>
      {rails.length === 0 ? (
        <Empty title="No legacy discovery rows in this range" />
      ) : (
        <>
          <p className="mb-2 text-xs text-gray-500">Select a rail to see its venues and clicks by recorded card position.</p>
          <Table cols={cols} rows={rails} rowKey={(r) => r.railName} caption="Legacy rails" />
        </>
      )}
      {p.rail && detail && <LegacyRailDetail p={p} rail={p.rail} detail={detail} names={names} />}
    </div>
  );
}

function LegacyRailDetail({
  p,
  rail,
  detail,
  names,
}: {
  p: ReportParams;
  rail: string;
  detail: ReturnType<typeof aggregateLegacyRailDetail>;
  names: Awaited<ReturnType<typeof resolveNames>>;
}) {
  const isSpecials = rail === "homepage_rail:todays-specials";
  const venueCols: Col<LegacyRailVenueRow>[] = [
    { key: "v", label: isSpecials ? "Venue (special not recorded)" : "Venue", render: (v) => <span className="font-medium text-gray-900">{venueName(names, v.venueId)}</span> },
    { key: "pos", label: "Positions recorded", render: (v) => (v.positions.length ? v.positions.map((x) => `#${x + 1}`).join(", ") : "—") },
    { key: "loads", label: "Load rows", align: "right", title: "Written when the rail rendered — not seen", render: (v) => fmt(v.loadRows) },
    { key: "clicks", label: "Clicks", align: "right", render: (v) => fmt(v.clicks) },
    { key: "cs", label: "Click sessions", align: "right", render: (v) => fmt(v.clickSessions) },
  ];
  const posCols: Col<LegacyRailPositionRow>[] = [
    { key: "p", label: "Card position", render: (r) => `#${r.position + 1}` },
    { key: "loads", label: "Load rows", align: "right", render: (r) => fmt(r.loadRows) },
    { key: "clicks", label: "Clicks", align: "right", render: (r) => fmt(r.clicks) },
  ];
  return (
    <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-base font-semibold text-slate-900">Legacy rail detail: {legacyRailLabel(rail, names)}</h2>
        <Link href={hrefFor(p, { rail: null })} className="text-xs text-gray-500 hover:text-gray-700">
          Close ✕
        </Link>
      </div>
      <div className="mb-4 space-y-2">
        <Note tone="warn">
          Load rows count every time this rail rendered on a page, whether or not the card was scrolled into view, and they include
          staging and production traffic. Use them only to see how often a venue was <em>placed</em> here — never
          as impressions or as a click-through denominator.
          {isSpecials && " Today’s Specials used one fixed rail name and recorded only the venue, so the special that was clicked can’t be recovered."}
          {rail.startsWith("guide:") && " Guide rails were recorded by the guide’s web address (slug); a renamed guide is matched through its slug history where possible."}
        </Note>
        <PositionHelp legacy />
      </div>
      {detail.byVenue.length === 0 ? (
        <Empty title="No legacy rows for this rail in this range" />
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-2">By venue — sorted by clicks.</p>
          <div className="mb-5">
            <Table cols={venueCols} rows={detail.byVenue} rowKey={(v) => v.venueId} caption="Legacy rail venues" />
          </div>
          <p className="text-xs text-gray-500 mb-2">By recorded card position within the rail.</p>
          <Table cols={posCols} rows={detail.byPosition} rowKey={(r) => String(r.position)} caption="Legacy rail positions" />
        </>
      )}
    </div>
  );
}
