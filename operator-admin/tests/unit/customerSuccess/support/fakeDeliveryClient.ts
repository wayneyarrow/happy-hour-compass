/**
 * In-memory stand-in for the full slice of Supabase the Phase 1B delivery
 * pipeline touches: venues, markets, operator_memberships,
 * customer_success_events, customer_success_baselines, plus the
 * venue_view_counts() RPC (migration 088) that detection calls. Generic
 * enough to support every query shape processCustomerSuccessDeliveries.ts
 * and its dependencies actually use (.eq/.not/.is/.lte/.in/.range/.order,
 * .maybeSingle(), .update()/.insert() with the same uniqueness semantics
 * as the real partial unique indexes — including the migration
 * 095_customer_success_delivery.sql widening from "one pending" to "one
 * active (pending OR processing)").
 */

type Row = Record<string, unknown>;

function getField(row: Row, col: string): unknown {
  return row[col];
}

function makeSelectBuilder<T extends Row>(rows: T[]) {
  const filters: Array<(r: T) => boolean> = [];
  let rangeBounds: [number, number] | null = null;
  let orderCol: string | null = null;
  let orderAsc = true;

  const builder = {
    eq(col: string, val: unknown) {
      filters.push((r) => getField(r, col) === val);
      return builder;
    },
    neq(col: string, val: unknown) {
      filters.push((r) => getField(r, col) !== val);
      return builder;
    },
    not(col: string, op: string, val: unknown) {
      if (op !== "is" || val !== null) throw new Error(`fake: unsupported not(${col}, ${op}, ${val})`);
      filters.push((r) => getField(r, col) !== null && getField(r, col) !== undefined);
      return builder;
    },
    is(col: string, val: null) {
      if (val !== null) throw new Error(`fake: unsupported is(${col}, ${val})`);
      filters.push((r) => getField(r, col) === null || getField(r, col) === undefined);
      return builder;
    },
    lte(col: string, val: unknown) {
      filters.push((r) => {
        const v = getField(r, col);
        return v !== null && v !== undefined && (v as string) <= (val as string);
      });
      return builder;
    },
    in(col: string, vals: unknown[]) {
      filters.push((r) => vals.includes(getField(r, col)));
      return builder;
    },
    range(from: number, to: number) {
      rangeBounds = [from, to];
      return builder;
    },
    order(col: string, o?: { ascending?: boolean }) {
      orderCol = col;
      orderAsc = o?.ascending !== false;
      return builder;
    },
    async maybeSingle() {
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      return { data: matched[0] ? { ...matched[0] } : null, error: null };
    },
    then<TResult1, TResult2 = never>(
      onfulfilled?: ((value: { data: T[]; count: number; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      let matched = rows.filter((r) => filters.every((f) => f(r)));
      if (orderCol) {
        const col = orderCol;
        matched = [...matched].sort((a, b) => {
          const av = getField(a, col) as string | number;
          const bv = getField(b, col) as string | number;
          return av < bv ? -1 : av > bv ? 1 : 0;
        });
        if (!orderAsc) matched.reverse();
      }
      const total = matched.length;
      if (rangeBounds) matched = matched.slice(rangeBounds[0], rangeBounds[1] + 1);
      return Promise.resolve({ data: matched.map((r) => ({ ...r })), count: total, error: null }).then(
        onfulfilled,
        onrejected
      );
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

function makeUpdateBuilder<T extends Row>(rows: T[], patch: Partial<T>) {
  const filters: Array<(r: T) => boolean> = [];
  const apply = (): T[] => {
    const matched = rows.filter((r) => filters.every((f) => f(r)));
    for (const row of matched) Object.assign(row, patch);
    return matched;
  };
  const builder = {
    eq(col: string, val: unknown) {
      filters.push((r) => getField(r, col) === val);
      return builder;
    },
    is(col: string, val: null) {
      if (val !== null) throw new Error(`fake: unsupported is(${col}, ${val})`);
      filters.push((r) => getField(r, col) === null || getField(r, col) === undefined);
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

// ── Table row shapes ─────────────────────────────────────────────────────────

export type FakeVenueRow = {
  id: string;
  is_published: boolean;
  is_verified: boolean;
  created_by_operator_id: string | null;
  market_id: string | null;
  name: string | null;
};

export type FakeMarketRow = { id: string; slug: string };

export type FakeMembershipRow = {
  id: string;
  operator_id: string;
  role: "owner" | "member";
  email: string;
  full_name: string | null;
  status: "active" | "invited" | "cancelled";
};

export type FakeCsEventRow = {
  id: string;
  venue_id: string;
  operator_id: string | null;
  event_type: string;
  milestone_value: number | null;
  metric_value_at_detection: number | null;
  achieved_at: string;
  communication_status: string;
  sent_at: string | null;
  recipient_email: string | null;
  provider_message_id: string | null;
  metadata_json: unknown;
  next_attempt_at: string | null;
  attempt_count: number;
  last_attempted_at: string | null;
  last_error: string | null;
  processing_started_at: string | null;
  recipient_blocked_reason: string | null;
  recipient_blocked_notified_at: string | null;
  sent_notification_sent_at: string | null;
};

export type FakeBaselineRow = { id: string; venue_id: string; event_type: string; metric_value_at_baseline: number | null };

export function makeFakeCsEventRow(overrides: Partial<FakeCsEventRow> & { venue_id: string }): FakeCsEventRow {
  return {
    id: overrides.id ?? `event-${Math.random().toString(36).slice(2)}`,
    venue_id: overrides.venue_id,
    operator_id: overrides.operator_id ?? null,
    event_type: overrides.event_type ?? "venue_view_milestone",
    milestone_value: overrides.milestone_value ?? null,
    metric_value_at_detection: overrides.metric_value_at_detection ?? null,
    achieved_at: overrides.achieved_at ?? new Date().toISOString(),
    communication_status: overrides.communication_status ?? "pending",
    sent_at: overrides.sent_at ?? null,
    recipient_email: overrides.recipient_email ?? null,
    provider_message_id: overrides.provider_message_id ?? null,
    metadata_json: overrides.metadata_json ?? null,
    next_attempt_at: overrides.next_attempt_at ?? null,
    attempt_count: overrides.attempt_count ?? 0,
    last_attempted_at: overrides.last_attempted_at ?? null,
    last_error: overrides.last_error ?? null,
    processing_started_at: overrides.processing_started_at ?? null,
    recipient_blocked_reason: overrides.recipient_blocked_reason ?? null,
    recipient_blocked_notified_at: overrides.recipient_blocked_notified_at ?? null,
    sent_notification_sent_at: overrides.sent_notification_sent_at ?? null,
  };
}

export function createFakeDeliveryClient(seed: {
  venues?: FakeVenueRow[];
  markets?: FakeMarketRow[];
  memberships?: FakeMembershipRow[];
  csEvents?: FakeCsEventRow[];
  csBaselines?: FakeBaselineRow[];
  viewCounts?: Map<string, number>;
}) {
  const venues = seed.venues ?? [];
  const markets = seed.markets ?? [];
  const memberships = seed.memberships ?? [];
  const csEvents = seed.csEvents ?? [];
  const csBaselines = seed.csBaselines ?? [];
  const viewCounts = seed.viewCounts ?? new Map<string, number>();

  let idCounter = 0;
  const nextId = () => `fake-${++idCounter}`;

  const client = {
    from(table: string) {
      if (table === "venues") {
        return { select: () => makeSelectBuilder(venues) };
      }
      if (table === "markets") {
        return { select: () => makeSelectBuilder(markets) };
      }
      if (table === "operator_memberships") {
        return { select: () => makeSelectBuilder(memberships) };
      }
      if (table === "customer_success_baselines") {
        return {
          select: () => makeSelectBuilder(csBaselines),
          insert(obj: Record<string, unknown>) {
            const venue_id = obj.venue_id as string;
            const event_type = obj.event_type as string;
            const dup = csBaselines.some((r) => r.venue_id === venue_id && r.event_type === event_type);
            if (dup) return makeStaticResult(null, { code: "23505", message: "duplicate" });
            const row: FakeBaselineRow = {
              id: nextId(),
              venue_id,
              event_type,
              metric_value_at_baseline: (obj.metric_value_at_baseline as number | null) ?? null,
            };
            csBaselines.push(row);
            return makeStaticResult([row], null);
          },
        };
      }
      if (table === "customer_success_events") {
        return {
          select: () => makeSelectBuilder(csEvents),
          update(patch: Partial<FakeCsEventRow>) {
            return makeUpdateBuilder(csEvents, patch);
          },
          insert(obj: Record<string, unknown>) {
            const venue_id = obj.venue_id as string;
            const event_type = obj.event_type as string;
            const milestone_value = (obj.milestone_value as number | null) ?? null;
            const communication_status = (obj.communication_status as string) ?? "pending";

            const dupMilestone = csEvents.some(
              (r) => r.venue_id === venue_id && r.event_type === event_type && r.milestone_value === milestone_value
            );
            // Mirrors customer_success_events_one_active_uidx (migration 095):
            // at most one row per (venue_id, event_type) in ('pending','processing').
            const dupActive =
              (communication_status === "pending" || communication_status === "processing") &&
              csEvents.some(
                (r) =>
                  r.venue_id === venue_id &&
                  r.event_type === event_type &&
                  (r.communication_status === "pending" || r.communication_status === "processing")
              );

            if (dupMilestone || dupActive) return makeStaticResult(null, { code: "23505", message: "duplicate" });

            const row = makeFakeCsEventRow({
              id: nextId(),
              venue_id,
              operator_id: (obj.operator_id as string | null) ?? null,
              event_type,
              milestone_value,
              metric_value_at_detection: (obj.metric_value_at_detection as number | null) ?? null,
              communication_status,
            });
            csEvents.push(row);
            return makeStaticResult([row], null);
          },
        };
      }
      throw new Error(`fake client: unexpected table "${table}"`);
    },

    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "venue_view_counts") {
        const ids = args.p_venue_ids as string[] | null;
        const rows = [...viewCounts.entries()]
          .filter(([venueId]) => ids === null || ids.includes(venueId))
          .map(([venue_id, views]) => ({ venue_id, views }));
        return { data: rows, error: null };
      }
      return { data: null, error: { message: `fake client: unknown rpc "${fn}"` } };
    },
  };

  return { client, venues, markets, memberships, csEvents, csBaselines, viewCounts };
}
