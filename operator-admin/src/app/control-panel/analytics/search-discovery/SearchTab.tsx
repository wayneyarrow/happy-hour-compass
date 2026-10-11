import { loadSearchRows } from "@/lib/data/searchDiscoveryReport";
import {
  aggregateLegacySearch,
  aggregateSearchDemand,
  type LegacyTermStat,
  type SearchTermStat,
} from "@/lib/searchDiscoveryReporting/searchMetrics";
import { formatVancouverDateTime } from "@/lib/searchDiscoveryReporting/config";
import { hrefFor, type ReportParams } from "./context";
import { Badge, DailyBars, Empty, Kpi, Note, Pills, SectionHeader, Table, fmt, formatRate, type Col } from "./ui";

const MODE_LABELS: Record<string, string> = { happy_hours: "Happy Hours", daily_specials: "Daily Specials", events: "Events", unknown: "Unknown (old client)" };
const SURFACE_LABELS: Record<string, string> = { homepage_hero: "Homepage hero", listing_page: "Listing page" };
const TOP_N = 50;

export default async function SearchTab({ p, since, until }: { p: ReportParams; since: string | null; until: string }) {
  const rows = await loadSearchRows(p.source, since, until);
  return p.source === "legacy" ? <LegacySearch p={p} rows={rows} /> : <NewSearch p={p} rows={rows} />;
}

const ORIGIN_LABELS = { typed: "Typed searches", url: "URL ?q= landings" } as const;

function Filters({ p, legacy }: { p: ReportParams; legacy?: boolean }) {
  return (
    <div className="flex flex-col gap-2 mb-5">
      {!legacy && (
        <Pills
          label="Ranked by"
          options={(["typed", "url"] as const).map((o) => ({ label: ORIGIN_LABELS[o], href: hrefFor(p, { origin: o }), active: p.origin === o }))}
        />
      )}
      {!legacy && (
        <Pills
          label="Mode"
          options={[
            { label: "All", href: hrefFor(p, { mode: null }), active: !p.mode },
            ...(["happy_hours", "daily_specials", "events"] as const).map((m) => ({ label: MODE_LABELS[m], href: hrefFor(p, { mode: m }), active: p.mode === m })),
          ]}
        />
      )}
      <Pills
        label="Surface"
        options={[
          { label: "All", href: hrefFor(p, { surface: null }), active: !p.surface },
          { label: "Homepage hero", href: hrefFor(p, { surface: "homepage_hero" }), active: p.surface === "homepage_hero" },
          { label: "Listing pages", href: hrefFor(p, { surface: "listing_page" }), active: p.surface === "listing_page" },
        ]}
      />
    </div>
  );
}

function NewSearch({ p, rows }: { p: ReportParams; rows: Parameters<typeof aggregateSearchDemand>[0] }) {
  const r = aggregateSearchDemand(rows, { mode: p.mode, surface: p.surface, rankedOrigin: p.origin });
  const typed = p.origin === "typed";
  const noun = typed ? "typed searches" : "URL landings";
  const termCols: Col<SearchTermStat>[] = [
    { key: "term", label: "Term", render: (t) => <span className="font-medium text-gray-900">{t.term}</span> },
    {
      key: "sessions",
      label: typed ? "Typing sessions" : "Landing sessions",
      align: "right",
      title: `Distinct browser tabs with ≥1 ${typed ? "typed search" : "?q= landing"} for this term`,
      render: (t) => fmt(t.rankedSessions),
    },
    { key: "typed", label: "Typed", align: "right", render: (t) => fmt(t.typedEvents) },
    { key: "url", label: "URL ?q=", align: "right", render: (t) => fmt(t.urlEvents) },
    { key: "history", label: "Back/forward", align: "right", title: "Shown, never ranked", render: (t) => fmt(t.historyEvents) },
    { key: "handoff", label: "Hero hand-off", align: "right", title: "Listing page opened by the hero's “See all” — the hero row is the original search", render: (t) => fmt(t.heroHandoffEvents) },
    { key: "unknown", label: "Unknown origin", align: "right", title: "From browsers still running the pre-release page", render: (t) => fmt(t.unknownOriginEvents) },
    { key: "zero", label: "Zero results", align: "right", title: `${typed ? "Typed searches" : "URL landings"} with 0 results, a full count and no other filters`, render: (t) => fmt(t.zeroResultEvents) },
    { key: "zerof", label: "Zero (filters on)", align: "right", title: "0 results while other filters were also active — may not be the term", render: (t) => fmt(t.zeroWithFiltersEvents) },
    { key: "modes", label: "Mode", render: (t) => t.modes.map((m) => MODE_LABELS[m] ?? m).join(", ") },
    { key: "surfaces", label: "Surface", render: (t) => t.surfaces.map((s) => SURFACE_LABELS[s] ?? s).join(", ") },
    { key: "last", label: "Last seen", render: (t) => <span className="whitespace-nowrap">{formatVancouverDateTime(t.lastSeen)}</span> },
  ];
  const col = (k: string) => termCols.find((c) => c.key === k)!;
  const zeroCols: Col<SearchTermStat>[] = [
    col("term"),
    { key: "zs", label: "Sessions with zero", align: "right", render: (t) => fmt(t.zeroResultSessions) },
    { key: "zero", label: "Zero-result searches", align: "right", render: (t) => fmt(t.zeroResultEvents) },
    { key: "all", label: typed ? "All typed searches" : "All URL landings", align: "right", render: (t) => fmt(t.rankedEvents) },
    col("modes"),
    col("surfaces"),
    col("last"),
  ];

  return (
    <div>
      <Filters p={p} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Kpi label={typed ? "Typed searches" : "URL landings"} value={fmt(r.rankedEvents)} />
        <Kpi label={typed ? "Typing sessions" : "Landing sessions"} value={fmt(r.rankedSessions)} sub="Distinct browser tabs, not people" />
        <Kpi label="Distinct terms" value={fmt(r.distinctTerms)} />
        <Kpi label="Zero-result share" value={formatRate(r.rankedEvents ? r.zeroResultEvents / r.rankedEvents : null)} sub={`${fmt(r.zeroResultEvents)} zero-result ${noun}`} />
      </div>
      <div className="mb-6">
        <Note>
          Rows analysed: {fmt(r.rowsAnalysed)} — typed {fmt(r.originCounts.typed)}, URL {fmt(r.originCounts.url)}, back/forward{" "}
          {fmt(r.originCounts.history)}, hero hand-off {fmt(r.originCounts.hero_see_all)}, unknown origin {fmt(r.originCounts.unknown)}.{" "}
          <strong>Typed searches</strong> (what visitors asked for on the site) and <strong>URL landings</strong> (pages opened with
          ?q=, often from an external or shared link — one link can bring many identical sessions) are ranked separately and never
          added together. Back/forward re-displays and hero “See all” hand-offs (the hero row is the original search) are never ranked;
          unknown-origin rows come from browsers still running the pre-release page. Hero counts are full totals, not the 8 suggestions shown.
        </Note>
      </div>

      {r.terms.length === 0 ? (
        <Empty title={`No qualifying ${noun} recorded in this range`}>
          Search tracking is on; release-QA sessions are excluded
          {r.rowsAnalysed > 0 ? `, and the ${fmt(r.rowsAnalysed)} other search rows in this range have a different origin.` : "."}
        </Empty>
      ) : (
        <>
          <div className="mb-8">
            <SectionHeader
              title={typed ? "Top typed search terms" : "Top URL-landing terms"}
              description={`Ranked by distinct ${typed ? "typing" : "landing"} sessions. Top ${Math.min(TOP_N, r.terms.length)} of ${fmt(r.terms.length)}.`}
            />
            <Table cols={termCols} rows={r.terms.slice(0, TOP_N)} rowKey={(t) => t.term} caption="Top search terms" />
          </div>
          <div className="mb-8">
            <SectionHeader
              title="Zero-result terms"
              description={`Content gaps: ${noun} that found nothing with no other filter narrowing the results.`}
            />
            {r.zeroResultTerms.length === 0 ? (
              <Empty title={`No zero-result ${noun} in this range`} />
            ) : (
              <Table cols={zeroCols} rows={r.zeroResultTerms.slice(0, TOP_N)} rowKey={(t) => t.term} caption="Zero-result terms" />
            )}
          </div>
          <div className="mb-8">
            <SectionHeader title={`${typed ? "Typed searches" : "URL landings"} per day`} description="America/Vancouver calendar days." />
            <DailyBars days={r.daily.map((d) => ({ day: d.day, value: d.events }))} />
          </div>
        </>
      )}
    </div>
  );
}

function LegacySearch({ p, rows }: { p: ReportParams; rows: Parameters<typeof aggregateLegacySearch>[0] }) {
  const r = aggregateLegacySearch(rows, { surface: p.surface });
  const cols: Col<LegacyTermStat>[] = [
    { key: "term", label: "Term", render: (t) => <span className="font-medium text-gray-900">{t.term}</span> },
    { key: "sessions", label: "Sessions", align: "right", render: (t) => fmt(t.sessions) },
    { key: "events", label: "Searches (collapsed)", align: "right", render: (t) => fmt(t.events) },
    { key: "zero", label: "Zero results", align: "right", render: (t) => fmt(t.zeroResultEvents) },
    {
      key: "single",
      label: "Single-search sessions",
      align: "right",
      title: "Tabs whose only legacy search was this term — a high share can mean repeated link landings",
      render: (t) => fmt(t.singleSearchSessions),
    },
    { key: "surfaces", label: "Surface", render: (t) => t.surfaces.map((s) => SURFACE_LABELS[s] ?? s).join(", ") },
    { key: "last", label: "Last seen", render: (t) => <span className="whitespace-nowrap">{formatVancouverDateTime(t.lastSeen)}</span> },
  ];
  return (
    <div>
      <Filters p={p} legacy />
      <div className="mb-5">
        <Note tone="warn">
          <strong>Legacy / mixed traffic (before Oct 10, 2026).</strong> Origin and mode were not recorded, so typed searches, link landings
          and back/forward can&apos;t be told apart. Staging, local and production traffic are mixed. The old capture fired after a 200ms
          pause and logged partial words; a row is collapsed when the same tab and surface searched a longer version within 30 seconds
          ({fmt(r.prefixRowsRemoved)} of {fmt(r.rawRows)} rows removed). Hero result counts were capped at 8. Unusual patterns, such as the
          repeated single-search “boston pizza” sessions, are left in — see “Single-search sessions”.
        </Note>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Raw rows" value={fmt(r.rawRows)} />
        <Kpi label="After prefix collapse" value={fmt(r.collapsedRows)} />
        <Kpi label="Sessions" value={fmt(r.sessions)} />
        <Kpi label="Distinct terms" value={fmt(r.terms.length)} />
      </div>
      {r.terms.length === 0 ? (
        <Empty title="No legacy searches in this range" />
      ) : (
        <>
          <div className="mb-8">
            <SectionHeader title="Legacy top terms" description={`Top ${Math.min(TOP_N, r.terms.length)} of ${fmt(r.terms.length)}, by sessions.`} />
            <Table cols={cols} rows={r.terms.slice(0, TOP_N)} rowKey={(t) => t.term} caption="Legacy top terms" />
          </div>
          <div className="mb-8">
            <SectionHeader title="Legacy zero-result terms" description={<>Other filters weren&apos;t recorded — some zeros may come from filters. <Badge tone="amber">unverified</Badge></>} />
            <Table cols={cols} rows={r.zeroResultTerms.slice(0, TOP_N)} rowKey={(t) => t.term} caption="Legacy zero-result terms" />
          </div>
        </>
      )}
    </div>
  );
}
