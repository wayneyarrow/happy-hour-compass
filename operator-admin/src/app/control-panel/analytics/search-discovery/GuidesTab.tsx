import Link from "next/link";
import { loadDiscoveryRows, loadLegacyDiscovery, legacyRailLabel, resolveNames } from "@/lib/data/searchDiscoveryReport";
import {
  aggregateGuideOpensFromHomepage,
  aggregateGuidePages,
  aggregateLegacyRails,
  aggregatePlacementItems,
  type GuideBlockStat,
  type GuideOpenStat,
  type ItemRow,
  type LegacyRailStat,
} from "@/lib/searchDiscoveryReporting/placementMetrics";
import { hrefFor, type ReportParams } from "./context";
import { GUIDE_BLOCK_LABELS, ITEM_TYPE_LABELS, guideTitle, itemName, sectionTitle } from "./labels";
import { Empty, Kpi, Note, SectionHeader, Table, fmt, formatRate, type Col } from "./ui";

export default async function GuidesTab({ p, since, until }: { p: ReportParams; since: string | null; until: string }) {
  if (p.source === "legacy") return LegacyGuides({ since, until });
  const rows = await loadDiscoveryRows(p.source, since, until);
  const opens = aggregateGuideOpensFromHomepage(rows);
  const pages = aggregateGuidePages(rows);
  const blocks = p.guide ? (["venues", "events", "related_guides"] as const).map((b) => ({ b, items: aggregatePlacementItems(rows, `g:${p.guide}:${b}`) })) : [];
  const detailItems = blocks.flatMap((x) => x.items);
  const names = await resolveNames({
    guideIds: [...opens.map((o) => o.guideId), ...pages.map((g) => g.guideId), ...(p.guide ? [p.guide] : []), ...detailItems.filter((i) => i.itemType === "guide").map((i) => i.itemId)],
    sectionIds: opens.flatMap((o) => o.sectionIds),
    venueIds: detailItems.filter((i) => i.itemType === "venue").map((i) => i.itemId),
    eventIds: detailItems.filter((i) => i.itemType === "event").map((i) => i.itemId),
  });

  const openCols: Col<GuideOpenStat>[] = [
    { key: "g", label: "Guide", render: (o) => <span className="font-medium text-gray-900">{guideTitle(names, o.guideId)}</span> },
    { key: "s", label: "Homepage section", render: (o) => o.sectionIds.map((id) => sectionTitle(names, id).title).join(", ") },
    { key: "imp", label: "Card impressions", align: "right", render: (o) => fmt(o.impressions) },
    { key: "raw", label: "Clicks to open", align: "right", render: (o) => fmt(o.rawClicks) },
    { key: "ctr", label: "Item CTR", align: "right", render: (o) => formatRate(o.ctr) },
    { key: "un", label: "Unmatched clicks", align: "right", render: (o) => fmt(o.unmatchedClicks) },
  ];

  const blockCols: Col<GuideBlockStat>[] = [
    { key: "b", label: "Block", render: (b) => GUIDE_BLOCK_LABELS[b.block] ?? b.block },
    { key: "exp", label: "Exposed page views", align: "right", render: (b) => fmt(b.exposedPageViews) },
    { key: "imp", label: "Card impressions", align: "right", render: (b) => fmt(b.impressions) },
    { key: "raw", label: "Raw clicks", align: "right", render: (b) => fmt(b.rawClicks) },
    { key: "ctr", label: "Item CTR", align: "right", render: (b) => formatRate(b.ctr) },
    { key: "un", label: "Unmatched clicks", align: "right", render: (b) => fmt(b.unmatchedClicks) },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label="Guide opens from homepage" value={fmt(opens.reduce((a, o) => a + o.rawClicks, 0))} sub="Clicks on homepage guide cards" />
        <Kpi label="Guide page views" value={fmt(pages.reduce((a, g) => a + g.pageViews, 0))} sub="With ≥1 tracked guide event" />
        <Kpi label="Venue clicks inside guides" value={fmt(pages.reduce((a, g) => a + (g.blocks.find((b) => b.block === "venues")?.rawClicks ?? 0), 0))} />
        <Kpi label="Event clicks inside guides" value={fmt(pages.reduce((a, g) => a + (g.blocks.find((b) => b.block === "events")?.rawClicks ?? 0), 0))} />
      </div>
      <div className="mb-6">
        <Note>
          Two different things: <strong>opening a guide</strong> (a homepage guide card clicked) and <strong>clicking a venue or event inside a
          guide</strong>. They&apos;re reported separately and never summed. “More guides” clicks inside a guide open another guide.
        </Note>
      </div>

      <div className="mb-8">
        <SectionHeader title="Guides opened from the homepage" />
        {opens.length === 0 ? <Empty title="No homepage guide cards seen or clicked in this range" /> : <Table cols={openCols} rows={opens} rowKey={(o) => o.guideId} caption="Guides opened from the homepage" />}
      </div>

      <div className="mb-8">
        <SectionHeader title="Inside guide pages" description="Per guide, per block. Select a guide for card and position detail." />
        {pages.length === 0 ? (
          <Empty title="No guide page activity in this range" />
        ) : (
          <div className="space-y-4">
            {pages.map((g) => (
              <div key={g.guideId}>
                <div className="flex flex-wrap items-baseline gap-2 mb-1.5">
                  <Link href={hrefFor(p, { guide: g.guideId })} className="text-sm font-semibold text-slate-900 underline-offset-2 hover:underline">
                    {guideTitle(names, g.guideId)}
                  </Link>
                  <span className="text-xs text-gray-500">{fmt(g.pageViews)} page views</span>
                </div>
                <Table cols={blockCols} rows={g.blocks} rowKey={(b) => b.block} caption={`Blocks in ${guideTitle(names, g.guideId)}`} />
              </div>
            ))}
          </div>
        )}
      </div>

      {p.guide && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-base font-semibold text-slate-900">Guide detail: {guideTitle(names, p.guide)}</h2>
            <Link href={hrefFor(p, { guide: null })} className="text-xs text-gray-500 hover:text-gray-700">Close ✕</Link>
          </div>
          {blocks.every((x) => x.items.length === 0) ? (
            <Empty title="No card activity for this guide in this range" />
          ) : (
            blocks
              .filter((x) => x.items.length > 0)
              .map((x) => (
                <div key={x.b} className="mb-4">
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">{GUIDE_BLOCK_LABELS[x.b]}</p>
                  <Table
                    cols={guideItemCols(names)}
                    rows={x.items}
                    rowKey={(i) => `${i.itemType}:${i.itemId}`}
                    caption={GUIDE_BLOCK_LABELS[x.b]}
                  />
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}

function guideItemCols(names: Awaited<ReturnType<typeof resolveNames>>): Col<ItemRow>[] {
  return [
    { key: "n", label: "Card", render: (i) => <span className="font-medium text-gray-900">{itemName(names, i.itemType, i.itemId)}</span> },
    { key: "t", label: "Type", render: (i) => ITEM_TYPE_LABELS[i.itemType] ?? i.itemType },
    { key: "p", label: "Positions", render: (i) => (i.positions.length ? i.positions.map((x) => x + 1).join(", ") : "—") },
    { key: "imp", label: "Impressions", align: "right", render: (i) => fmt(i.impressions) },
    { key: "raw", label: "Raw clicks", align: "right", render: (i) => fmt(i.rawClicks) },
    { key: "m", label: "Clicked impressions", align: "right", render: (i) => fmt(i.matchedClicked) },
    { key: "ctr", label: "Item CTR", align: "right", render: (i) => formatRate(i.ctr) },
    { key: "un", label: "Unmatched clicks", align: "right", render: (i) => fmt(i.unmatchedClicks) },
  ];
}

async function LegacyGuides({ since, until }: { since: string | null; until: string }) {
  const legacy = await loadLegacyDiscovery(since, until);
  const rails = aggregateLegacyRails(legacy.loadCounts, legacy.clicks).filter((r) => r.railName.startsWith("guide:"));
  const names = await resolveNames({ guideSlugs: rails.map((r) => r.railName.slice(6)) });
  const cols: Col<LegacyRailStat>[] = [
    { key: "g", label: "Guide (legacy, by slug)", render: (r) => <span className="font-medium text-gray-900">{legacyRailLabel(r.railName, names)}</span> },
    { key: "l", label: "Load rows", align: "right", render: (r) => fmt(r.loadRows) },
    { key: "c", label: "Venue clicks", align: "right", render: (r) => fmt(r.clicks) },
    { key: "s", label: "Click sessions", align: "right", render: (r) => fmt(r.clickSessions) },
  ];
  return (
    <div>
      <div className="mb-5">
        <Note tone="warn">
          <strong>Legacy / mixed traffic.</strong> Before Oct 10, 2026 only venue cards inside guides were tracked (by guide slug), with
          load-based “impressions” and mixed environments. Homepage clicks that opened a guide were not tracked at all.
        </Note>
      </div>
      {rails.length === 0 ? <Empty title="No legacy guide rows in this range" /> : <Table cols={cols} rows={rails} rowKey={(r) => r.railName} caption="Legacy guides" />}
    </div>
  );
}
