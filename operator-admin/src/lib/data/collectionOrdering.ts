/**
 * Ordering rules for Algorithmic Collections — pure, no DB access, safe to
 * import from both the server resolver (collectionsPreview.ts) and the
 * Control Panel editor (ResolvedCollectionTable.tsx), so "how the resolver
 * orders" and "what Move Up/Down writes" can never drift apart.
 *
 * Final ordering precedence (orderAlgorithmicItems):
 *   1. Boost, highest first.
 *   2. Within equal boost, items with a stored position (an include override
 *      row: a promoted/reordered item or a manual add) in stored order...
 *   3. ...ahead of untouched items, which keep the algorithm's own order.
 *
 * Applies to the venue and event resolvers. Today's Specials ranks through
 * selectTodaysSpecials (todaysSpecialsRanking.ts), which uses boost but not
 * stored positions.
 */

export type OrderingOverride = { id: string; boost: number };

/**
 * Orders `items` (algorithm order first, manual adds after) by the precedence
 * above. `includeOverrides` must be the include-action override rows in stored
 * order — their index IS the stored position. Stable.
 */
export function orderAlgorithmicItems<T>(
  items: T[],
  idOf: (item: T) => string,
  includeOverrides: OrderingOverride[]
): { item: T; boost: number }[] {
  const boostById = new Map(includeOverrides.map((o) => [o.id, o.boost]));
  const positionById = new Map(includeOverrides.map((o, i) => [o.id, i]));

  return items
    .map((item, index) => ({ item, index, boost: boostById.get(idOf(item)) ?? 0, position: positionById.get(idOf(item)) }))
    .sort((a, b) => {
      if (b.boost !== a.boost) return b.boost - a.boost;
      if (a.position !== undefined && b.position !== undefined) return a.position - b.position;
      if (a.position !== undefined) return -1;
      if (b.position !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ item, boost }) => ({ item, boost }));
}

// ── Move Up / Move Down ──────────────────────────────────────────────────────

export type MovableRow = { id: string; action: "include" | "exclude"; boost: number };

/**
 * Whether the item at `index` can move one step in `direction`. Boost always
 * outranks stored position, so an item can't be moved past a neighbour with a
 * different boost — change the Boost value instead.
 */
export function canMoveResolvedItem(
  resolvedIds: string[],
  boostOf: (id: string) => number,
  index: number,
  direction: -1 | 1
): boolean {
  const target = index + direction;
  if (index < 0 || index >= resolvedIds.length || target < 0 || target >= resolvedIds.length) return false;
  return boostOf(resolvedIds[index]) === boostOf(resolvedIds[target]);
}

/**
 * Returns override rows that move the resolved item at `index` exactly one
 * position, leaving every other item where it was — or null when the move
 * isn't allowed (see canMoveResolvedItem).
 *
 * Stored positions sort ahead of untouched algorithm items (precedence 2-3
 * above), so swapping only the two affected items would lift both above
 * every untouched item before them. Instead, every resolved item up to and
 * including the lower of the two is given a stored position (`promote`
 * creates a boost-0 include row for an untouched item) in its current
 * resolved order, with the two items swapped. Rows outside that prefix keep
 * their relative order after it.
 *
 * Side effect, by design: the prefix is now pinned in that order, so a venue
 * the algorithm later ranks higher appears after it rather than above it.
 */
export function moveResolvedItem<R extends MovableRow>(
  resolvedIds: string[],
  rows: R[],
  index: number,
  direction: -1 | 1,
  promote: (id: string) => R
): R[] | null {
  const boostOf = (id: string) => rows.find((r) => r.id === id && r.action === "include")?.boost ?? 0;
  if (!canMoveResolvedItem(resolvedIds, boostOf, index, direction)) return null;

  const target = index + direction;
  const prefix = resolvedIds.slice(0, Math.max(index, target) + 1);
  [prefix[index], prefix[target]] = [prefix[target], prefix[index]];

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const prefixSet = new Set(prefix);
  const prefixRows = prefix.map((id) => rowById.get(id) ?? promote(id));
  const rest = rows.filter((r) => !prefixSet.has(r.id));
  return [...prefixRows, ...rest];
}

// ── Reset ordering overrides ─────────────────────────────────────────────────

/**
 * Clears ordering overrides: removes the stored position/Boost rows of
 * algorithm-picked items (so they return to the algorithm's order) and sets
 * manual additions' Boost to 0. Manual additions and exclusions are kept —
 * additions keep their stored rows, so they still sit above the automatic
 * picks (precedence 2 above). Pure: callers apply it to unsaved editor state.
 */
export function resetOrderingOverrides<R extends MovableRow>(rows: R[], isManualAdd: (row: R) => boolean): R[] {
  return rows
    .filter((r) => r.action === "exclude" || isManualAdd(r))
    .map((r) => (r.action === "include" && r.boost !== 0 ? { ...r, boost: 0 } : r));
}

/** Whether resetOrderingOverrides would change anything. */
export function hasOrderingOverrides<R extends MovableRow>(rows: R[], isManualAdd: (row: R) => boolean): boolean {
  return rows.some((r) => r.action === "include" && (!isManualAdd(r) || r.boost !== 0));
}
