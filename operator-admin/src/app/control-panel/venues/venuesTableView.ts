/**
 * Pure state, URL and derivation logic for the Control Panel Venues table
 * (VenuesTable.tsx). Kept free of React/DOM so the filter → sort → paginate
 * pipeline and the URL round-trip are unit-testable.
 *
 * Order of operations (counts, pagination and CSV export all read from it):
 *   filter (search, Published, Claimed, Verified, Market) → sort → paginate.
 */

import {
  MARKET_FILTER_ALL,
  MARKET_FILTER_PARAM,
  marketFilterParamValue,
  matchesMarketFilter,
  parseMarketFilter,
  type MarketAssignment,
  type MarketFilterOption,
  type MarketFilterSelection,
} from "@/lib/marketFilter";

export type VenueRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  is_published: boolean;
  is_verified: boolean;
  claimed_at: string | null;
  updated_at: string;      // ISO string
  operatorEmail: string | null;
} & MarketAssignment;

export type SortCol        = "name" | "city" | "market" | "is_published" | "is_verified" | "claimed_at" | "updated_at";
export type PubFilter      = "all" | "published" | "draft";
export type ClaimFilter    = "all" | "claimed" | "unclaimed";
export type VerifiedFilter = "all" | "verified" | "unverified";

export const PAGE_SIZE = 25;
export const DEFAULT_SORT: SortCol = "updated_at";

export type VenuesTableState = {
  q: string;
  pub: PubFilter;
  claimed: ClaimFilter;
  verified: VerifiedFilter;
  market: MarketFilterSelection;
  sortCol: SortCol;
  sortDir: "asc" | "desc";
  page: number;
};

export const DEFAULT_VENUES_TABLE_STATE: VenuesTableState = {
  q: "",
  pub: "all",
  claimed: "all",
  verified: "all",
  market: MARKET_FILTER_ALL,
  sortCol: DEFAULT_SORT,
  sortDir: "desc",
  page: 1,
};

/**
 * Reads the table state from a query string. Existing params keep their
 * pre-Market behaviour (taken as given); `market` is validated against the
 * loaded options and an unknown value means All markets. `marketRejected`
 * tells the caller to rewrite the URL without the bad value.
 */
export function parseVenuesUrlState(
  search: string,
  marketOptions: readonly MarketFilterOption[]
): { state: VenuesTableState; marketRejected: boolean } {
  const p = new URLSearchParams(search);
  const marketRaw = p.get(MARKET_FILTER_PARAM);
  const market = parseMarketFilter(marketRaw, marketOptions);
  const page = parseInt(p.get("page") ?? "1", 10);
  return {
    state: {
      q:        p.get("q") ?? "",
      pub:      (p.get("pub") ?? "all") as PubFilter,
      claimed:  (p.get("claimed") ?? "all") as ClaimFilter,
      verified: (p.get("verified") ?? "all") as VerifiedFilter,
      market,
      sortCol:  (p.get("sort") ?? DEFAULT_SORT) as SortCol,
      sortDir:  (p.get("dir") ?? "desc") as "asc" | "desc",
      page:     Number.isFinite(page) ? Math.max(1, page) : 1,
    },
    marketRejected: !!marketRaw && marketFilterParamValue(market) !== marketRaw,
  };
}

/** Serializes the state to a query string (no leading "?"); defaults are omitted. */
export function venuesUrlSearch(s: VenuesTableState): string {
  const p = new URLSearchParams();
  const marketParam = marketFilterParamValue(s.market);
  if (s.q)                        p.set("q", s.q);
  if (marketParam)                p.set(MARKET_FILTER_PARAM, marketParam);
  if (s.pub !== "all")            p.set("pub", s.pub);
  if (s.claimed !== "all")        p.set("claimed", s.claimed);
  if (s.verified !== "all")       p.set("verified", s.verified);
  if (s.sortCol !== DEFAULT_SORT) p.set("sort", s.sortCol);
  if (s.sortDir !== "desc")       p.set("dir", s.sortDir);
  if (s.page > 1)                 p.set("page", String(s.page));
  return p.toString();
}

/**
 * Displayed (and sorted) market name; null = Unassigned. An FK missing from
 * the loaded list (shouldn't happen — markets FK) shows as "Unknown market"
 * rather than being passed off as Unassigned.
 */
export function venueMarketLabel(v: MarketAssignment, marketNameById: ReadonlyMap<string, string>): string | null {
  return v.marketId === null ? null : (marketNameById.get(v.marketId) ?? "Unknown market");
}

export function filterVenues(rows: readonly VenueRow[], s: VenuesTableState): VenueRow[] {
  const lq = s.q.toLowerCase();
  return rows.filter((v) => {
    if (lq && !v.name.toLowerCase().includes(lq) &&
              !(v.operatorEmail?.toLowerCase().includes(lq))) return false;
    if (s.pub === "published"  && !v.is_published) return false;
    if (s.pub === "draft"      &&  v.is_published) return false;
    if (s.claimed === "claimed"   && !v.claimed_at) return false;
    if (s.claimed === "unclaimed" &&  v.claimed_at) return false;
    if (s.verified === "verified"   && !v.is_verified) return false;
    if (s.verified === "unverified" &&  v.is_verified) return false;
    if (!matchesMarketFilter(v, s.market)) return false;
    return true;
  });
}

function compareNullableText(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

export function sortVenues(
  rows: readonly VenueRow[],
  sortCol: SortCol,
  sortDir: "asc" | "desc",
  marketNameById: ReadonlyMap<string, string>
): VenueRow[] {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sortCol) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "city":
        cmp = compareNullableText(a.city, b.city);
        break;
      case "market":
        cmp = compareNullableText(venueMarketLabel(a, marketNameById), venueMarketLabel(b, marketNameById));
        break;
      case "is_published":
        cmp = a.is_published === b.is_published ? 0 : a.is_published ? -1 : 1;
        break;
      case "is_verified":
        cmp = a.is_verified === b.is_verified ? 0 : a.is_verified ? -1 : 1;
        break;
      case "claimed_at":
        cmp = compareNullableText(a.claimed_at, b.claimed_at);
        break;
      case "updated_at":
        cmp = a.updated_at.localeCompare(b.updated_at);
        break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });
}

export type VenuesView = {
  filtered: VenueRow[];
  sorted: VenueRow[];
  pageRows: VenueRow[];
  totalPages: number;
  safePage: number;
};

/** The full pipeline: filter → sort → paginate. */
export function deriveVenuesView(
  rows: readonly VenueRow[],
  s: VenuesTableState,
  marketNameById: ReadonlyMap<string, string>
): VenuesView {
  const filtered = filterVenues(rows, s);
  const sorted = sortVenues(filtered, s.sortCol, s.sortDir, marketNameById);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(s.page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  return { filtered, sorted, pageRows, totalPages, safePage };
}

/** Applies a change; any change other than paging returns to page 1. */
export function nextVenuesState(
  s: VenuesTableState,
  change: Partial<Omit<VenuesTableState, "page">> | { page: number }
): VenuesTableState {
  if ("page" in change) return { ...s, page: (change as { page: number }).page };
  return { ...s, ...change, page: 1 };
}

/** Sort-header click: same column toggles desc ↔ asc, a new column starts desc. */
export function nextSort(s: VenuesTableState, col: SortCol): Pick<VenuesTableState, "sortCol" | "sortDir"> {
  return { sortCol: col, sortDir: col === s.sortCol && s.sortDir === "desc" ? "asc" : "desc" };
}
