import { parseRange, parseSource, type RangePreset, type ReportSource } from "@/lib/searchDiscoveryReporting/config";

export type ReportTab = "search" | "placements" | "guides" | "venues";
export const REPORT_TABS: { value: ReportTab; label: string }[] = [
  { value: "search", label: "Search demand" },
  { value: "placements", label: "Homepage placements" },
  { value: "guides", label: "Guides" },
  { value: "venues", label: "Venue discovery" },
];

export type ReportParams = {
  tab: ReportTab;
  range: RangePreset;
  source: ReportSource;
  mode: string | null;
  surface: string | null;
  /** Search ranking origin: typed (default) or url (?q= landings) — never combined. */
  origin: "typed" | "url";
  section: string | null;
  guide: string | null;
  venue: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | undefined) => (v && UUID_RE.test(v) ? v.toLowerCase() : null);
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]): T | null => ((allowed as readonly string[]).includes(v ?? "") ? (v as T) : null);

export function parseParams(sp: Record<string, string | string[] | undefined>): ReportParams {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return {
    tab: oneOf(s("tab"), ["search", "placements", "guides", "venues"] as const) ?? "search",
    range: parseRange(s("range")),
    source: parseSource(s("source")),
    mode: oneOf(s("mode"), ["happy_hours", "daily_specials", "events"] as const),
    surface: oneOf(s("surface"), ["homepage_hero", "listing_page"] as const),
    origin: oneOf(s("origin"), ["typed", "url"] as const) ?? "typed",
    section: uuidOrNull(s("section")),
    guide: uuidOrNull(s("guide")),
    venue: uuidOrNull(s("venue")),
  };
}

const BASE = "/control-panel/analytics/search-discovery";

/** Link to this report with some params changed (null removes one). Defaults are omitted from the URL. */
export function hrefFor(p: ReportParams, overrides: Partial<Record<keyof ReportParams, string | null>>): string {
  const merged: Record<string, string | null> = { ...p, ...overrides } as Record<string, string | null>;
  const defaults: Record<string, string> = { tab: "search", range: "30d", source: "production", origin: "typed" };
  const qs = Object.entries(merged)
    .filter(([k, v]) => v !== null && v !== undefined && v !== "" && defaults[k] !== v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join("&");
  return qs ? `${BASE}?${qs}` : BASE;
}
