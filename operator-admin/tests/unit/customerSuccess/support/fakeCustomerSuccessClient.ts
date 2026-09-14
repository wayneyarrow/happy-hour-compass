/**
 * In-memory stand-in for the slice of Supabase (createAdminClient()) that
 * the Customer Success detector touches: venues (read-only here),
 * customer_success_events / customer_success_baselines (migration 093),
 * and the venue_view_counts() RPC (migration 088) that
 * src/lib/data/viewCounts.ts calls. Reimplements just enough query-builder
 * surface (.eq/.not/.in/.range/.order, count/head selects, update(), and
 * insert() with the same uniqueness constraints the real partial unique
 * indexes enforce — including customer_success_events_one_pending_uidx, so
 * an insert-before-demote ordering bug in the real code would fail here
 * too, the same simulated Postgres 23505 — to exercise
 * detectVenueViewMilestones.ts without a real database.
 */

type VenueRow = {
  id: string;
  is_published: boolean;
  is_verified: boolean;
  created_by_operator_id: string | null;
};

type CsEventRow = {
  id: string;
  venue_id: string;
  operator_id: string | null;
  event_type: string;
  milestone_value: number | null;
  metric_value_at_detection: number | null;
  communication_status: string;
  achieved_at: string;
};

type BaselineRow = {
  id: string;
  venue_id: string;
  event_type: string;
  metric_value_at_baseline: number | null;
};

type SelectOpts = { count?: "exact"; head?: boolean };
type QueryResult<T> = { data: T[] | null; count?: number | null; error: { code?: string; message: string } | null };

function makeSelectBuilder<T extends Record<string, unknown>>(rows: T[], opts?: SelectOpts) {
  const filters: Array<(row: T) => boolean> = [];
  let range: [number, number] | null = null;
  let orderCol: string | null = null;
  let orderAsc = true;

  const builder = {
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    not(col: string, op: string, val: unknown) {
      if (op !== "is" || val !== null) throw new Error(`fake client: unsupported not(${col}, ${op}, ${val})`);
      filters.push((r) => r[col] !== null && r[col] !== undefined);
      return builder;
    },
    in(col: string, vals: unknown[]) {
      filters.push((r) => vals.includes(r[col]));
      return builder;
    },
    range(from: number, to: number) {
      range = [from, to];
      return builder;
    },
    order(col: string, o?: { ascending?: boolean }) {
      orderCol = col;
      orderAsc = o?.ascending !== false;
      return builder;
    },
    then<TResult1, TResult2 = never>(
      onfulfilled?: ((value: QueryResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      let matched = rows.filter((r) => filters.every((f) => f(r)));
      if (orderCol) {
        const col = orderCol;
        matched = [...matched].sort((a, b) => {
          const av = a[col] as string | number;
          const bv = b[col] as string | number;
          return av < bv ? -1 : av > bv ? 1 : 0;
        });
        if (!orderAsc) matched.reverse();
      }
      const totalCount = matched.length;
      if (range) matched = matched.slice(range[0], range[1] + 1);

      const result: QueryResult<T> = opts?.head
        ? { data: null, count: totalCount, error: null }
        : { data: matched, count: opts?.count ? totalCount : undefined, error: null };

      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };

  return builder;
}

function makeStaticResult<T>(data: T[] | null, error: { code?: string; message: string } | null) {
  return {
    then<TResult1, TResult2 = never>(
      onfulfilled?: ((value: { data: T[] | null; error: typeof error }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return Promise.resolve({ data, error }).then(onfulfilled, onrejected);
    },
    select() {
      return makeStaticResult(data, error);
    },
  };
}

/** Chainable .eq()-filtered UPDATE, applying `patch` to matched rows on await/.select(). */
function makeUpdateBuilder<T extends Record<string, unknown>>(rows: T[], patch: Partial<T>) {
  const filters: Array<(row: T) => boolean> = [];

  const apply = (): T[] => {
    const matched = rows.filter((r) => filters.every((f) => f(r)));
    for (const row of matched) Object.assign(row, patch);
    return matched;
  };

  const builder = {
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    select() {
      const matched = apply();
      return makeStaticResult(matched.map((r) => ({ ...r })), null);
    },
    then<TResult1, TResult2 = never>(
      onfulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      apply();
      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
    },
  };

  return builder;
}

export function createFakeCustomerSuccessClient(seed: { venues: VenueRow[]; viewCounts: Map<string, number> }) {
  const csEvents: CsEventRow[] = [];
  const baselines: BaselineRow[] = [];
  let idCounter = 0;
  const nextId = () => `fake-cs-${++idCounter}`;

  const client = {
    from(table: string) {
      if (table === "venues") {
        return {
          select(_cols: string, opts?: SelectOpts) {
            return makeSelectBuilder(seed.venues, opts);
          },
        };
      }

      if (table === "customer_success_events") {
        return {
          select(_cols: string, opts?: SelectOpts) {
            return makeSelectBuilder(csEvents, opts);
          },
          update(patch: Partial<CsEventRow>) {
            return makeUpdateBuilder(csEvents, patch);
          },
          insert(obj: Record<string, unknown>) {
            const venue_id = obj.venue_id as string;
            const event_type = obj.event_type as string;
            const milestone_value = (obj.milestone_value as number | null) ?? null;
            const communication_status = obj.communication_status as string;

            // Mirrors customer_success_events_milestone_uidx /
            // customer_success_events_onetime_uidx (migration 093).
            const dupMilestone = csEvents.some(
              (r) => r.venue_id === venue_id && r.event_type === event_type && r.milestone_value === milestone_value
            );
            // Mirrors customer_success_events_one_pending_uidx (migration
            // 093) — at most one 'pending' row per (venue_id, event_type).
            const dupPending =
              communication_status === "pending" &&
              csEvents.some(
                (r) => r.venue_id === venue_id && r.event_type === event_type && r.communication_status === "pending"
              );

            if (dupMilestone || dupPending) {
              return makeStaticResult(null, {
                code: "23505",
                message: "duplicate key value violates unique constraint",
              });
            }

            const row: CsEventRow = {
              id: nextId(),
              venue_id,
              operator_id: (obj.operator_id as string | null) ?? null,
              event_type,
              milestone_value,
              metric_value_at_detection: (obj.metric_value_at_detection as number | null) ?? null,
              communication_status,
              achieved_at: new Date().toISOString(),
            };
            csEvents.push(row);
            return makeStaticResult([row], null);
          },
        };
      }

      if (table === "customer_success_baselines") {
        return {
          select(_cols: string, opts?: SelectOpts) {
            return makeSelectBuilder(baselines, opts);
          },
          insert(obj: Record<string, unknown>) {
            const venue_id = obj.venue_id as string;
            const event_type = obj.event_type as string;

            // Mirrors customer_success_baselines_venue_event_type_uidx.
            const dup = baselines.some((r) => r.venue_id === venue_id && r.event_type === event_type);
            if (dup) {
              return makeStaticResult(null, {
                code: "23505",
                message: "duplicate key value violates unique constraint",
              });
            }

            const row: BaselineRow = {
              id: nextId(),
              venue_id,
              event_type,
              metric_value_at_baseline: (obj.metric_value_at_baseline as number | null) ?? null,
            };
            baselines.push(row);
            return makeStaticResult([row], null);
          },
        };
      }

      throw new Error(`fake client: unexpected table "${table}"`);
    },

    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "venue_view_counts") {
        const ids = args.p_venue_ids as string[] | null;
        const rows = [...seed.viewCounts.entries()]
          .filter(([venueId]) => ids === null || ids.includes(venueId))
          .map(([venue_id, views]) => ({ venue_id, views }));
        return { data: rows, error: null };
      }
      return { data: null, error: { message: `fake client: unknown rpc "${fn}"` } };
    },
  };

  return { client, csEvents, baselines };
}
