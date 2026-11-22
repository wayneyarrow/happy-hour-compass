/**
 * Control Panel Market filter — pure, client-safe helpers shared by every
 * Control Panel screen that filters its rows by market (Venues first; Claims,
 * Submissions, Operators and the Venue Funnel are expected to reuse it).
 *
 * Options always come from the DB `markets` table (see
 * src/lib/data/controlPanelMarketOptions.ts), never from the hard-coded
 * MARKETS config in src/lib/markets.ts: the config is the public website's
 * hand-maintained list and its statuses can differ from the database's.
 * A market added through the normal geography setup (seedGeography.ts)
 * therefore appears here with no Control Panel code change.
 *
 * Selection model (one value, page-specific, in `?market=`):
 *   - MARKET_FILTER_ALL        — no `market` param; every row, including
 *                                 rows with no market assignment.
 *   - MARKET_FILTER_UNASSIGNED — `?market=unassigned`; rows whose
 *                                 market_id is NULL.
 *   - a market slug            — `?market=<markets.slug>`.
 * Any other value falls back to All markets. "unassigned" is reserved: it is
 * not a valid market slug for a future market.
 */

export const MARKET_FILTER_PARAM = "market";
export const MARKET_FILTER_ALL = "all";
export const MARKET_FILTER_UNASSIGNED = "unassigned";

/** One selectable market, in configured order. `status` is the DB markets.status. */
export type MarketFilterOption = {
  id: string;
  slug: string;
  name: string;
  status: string;
};

/** "all" | "unassigned" | a market slug present in the options. */
export type MarketFilterSelection = string;

/**
 * A row's market assignment: the raw FK plus the slug it resolves to (null
 * when unresolved). `marketInferred` marks an assignment derived from free
 * text (e.g. an unlinked submission's city/province) rather than a stored FK.
 */
export type MarketAssignment = {
  marketId: string | null;
  marketSlug: string | null;
  marketInferred?: boolean;
};

type MarketSource = {
  id: string;
  slug: string;
  name: string;
  status: string;
  displayOrder: number;
};

/**
 * Every configured market, ordered by display_order (name as a deterministic
 * tiebreak). Nothing is filtered out by status — coming-soon markets can
 * already hold seeded venues and pending records.
 */
export function buildMarketFilterOptions(markets: readonly MarketSource[]): MarketFilterOption[] {
  return [...markets]
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
    .map(({ id, slug, name, status }) => ({ id, slug, name, status }));
}

/** Dropdown label: the configured name, suffixed for coming-soon markets. */
export function marketFilterOptionLabel(option: MarketFilterOption): string {
  return option.status === "coming_soon" ? `${option.name} (coming soon)` : option.name;
}

/** Resolves a raw `?market=` value. Unknown, empty or missing values mean All markets. */
export function parseMarketFilter(
  raw: string | null | undefined,
  options: readonly MarketFilterOption[]
): MarketFilterSelection {
  if (!raw) return MARKET_FILTER_ALL;
  if (raw === MARKET_FILTER_UNASSIGNED) return MARKET_FILTER_UNASSIGNED;
  return options.some((o) => o.slug === raw) ? raw : MARKET_FILTER_ALL;
}

/** The `?market=` value to write for a selection — null means omit the param. */
export function marketFilterParamValue(selection: MarketFilterSelection): string | null {
  return selection === MARKET_FILTER_ALL ? null : selection;
}

/**
 * Does a row belong to the selection? Unassigned means the FK itself is NULL
 * (not merely "slug unresolved"), so a row is never mislabelled Unassigned.
 */
export function matchesMarketFilter(row: MarketAssignment, selection: MarketFilterSelection): boolean {
  if (selection === MARKET_FILTER_ALL) return true;
  if (selection === MARKET_FILTER_UNASSIGNED) return row.marketId === null;
  return row.marketSlug === selection;
}

/** Resolves a market_id to its assignment using the loaded options. */
export function resolveMarketAssignment(
  marketId: string | null,
  options: readonly MarketFilterOption[]
): MarketAssignment {
  if (!marketId) return { marketId: null, marketSlug: null };
  return { marketId, marketSlug: options.find((o) => o.id === marketId)?.slug ?? null };
}

/**
 * For rows attributed to several markets (an operator owning venues in more
 * than one): a market selection matches when ANY assignment is in it, and
 * Unassigned matches only when NO assignment has a market — including a row
 * with no assignments at all. Under All markets every row appears once.
 */
export function matchesAnyMarketFilter(
  rows: readonly MarketAssignment[],
  selection: MarketFilterSelection
): boolean {
  if (selection === MARKET_FILTER_ALL) return true;
  if (selection === MARKET_FILTER_UNASSIGNED) return rows.every((r) => r.marketId === null);
  return rows.some((r) => r.marketSlug === selection);
}

/**
 * Display name for a market FK; null = Unassigned. An FK missing from the
 * loaded list shows as "Unknown market" rather than being passed off as
 * Unassigned.
 */
export function marketDisplayName(
  marketId: string | null,
  options: readonly MarketFilterOption[]
): string | null {
  if (marketId === null) return null;
  return options.find((o) => o.id === marketId)?.name ?? "Unknown market";
}

/** Reads `?market=` from a query string; `rejected` = an unknown value was present. */
export function readMarketFilterParam(
  search: string,
  options: readonly MarketFilterOption[]
): { selection: MarketFilterSelection; rejected: boolean } {
  const raw = new URLSearchParams(search).get(MARKET_FILTER_PARAM);
  const selection = parseMarketFilter(raw, options);
  return { selection, rejected: !!raw && marketFilterParamValue(selection) !== raw };
}

/** Writes (or, for All markets, removes) `market` on a URLSearchParams in place. */
export function writeMarketFilterParam(params: URLSearchParams, selection: MarketFilterSelection): URLSearchParams {
  const value = marketFilterParamValue(selection);
  if (value) params.set(MARKET_FILTER_PARAM, value);
  else params.delete(MARKET_FILTER_PARAM);
  return params;
}
