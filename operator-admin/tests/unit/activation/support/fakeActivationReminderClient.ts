/**
 * In-memory stand-in for the slice of Supabase (createAdminClient()) that
 * processActivationReminders() touches: operator_activation_lifecycles,
 * operators, venue_claims, operator_submissions, venues,
 * venue_claim_notes, operator_submission_notes. Reimplements just enough
 * query-builder surface (.eq/.is/.not/.lt/.lte/.order/.limit/.maybeSingle,
 * update() with the same guarded-CAS semantics a real Postgres UPDATE ...
 * WHERE ... RETURNING has, and insert() enforcing the event_key partial
 * unique index) to exercise the orchestrator without a real database.
 */

export type FakeLifecycleRow = {
  id: string;
  operator_id: string;
  origin_type: "claim" | "submission";
  origin_claim_id: string | null;
  origin_submission_id: string | null;
  started_at: string;
  deadline_at: string;
  reminder_stage: number;
  expired_at: string | null;
  released_at: string | null;
  reminder_next_attempt_at: string | null;
  reminder_attempt_count: number;
  reminder_last_attempted_at: string | null;
  reminder_last_error: string | null;
  reminder_lease_stage: number | null;
  reminder_lease_started_at: string | null;
  expiry_slack_notified_at: string | null;
  expiry_founder_email_sent_at: string | null;
};

export function makeLifecycleRow(overrides: Partial<FakeLifecycleRow> & { id: string; operator_id: string }): FakeLifecycleRow {
  return {
    origin_type: "submission",
    origin_claim_id: null,
    origin_submission_id: "sub-1",
    started_at: "2026-09-18T23:41:30.607Z",
    deadline_at: "2026-10-02T23:41:30.607Z",
    reminder_stage: 0,
    expired_at: null,
    released_at: null,
    reminder_next_attempt_at: null,
    reminder_attempt_count: 0,
    reminder_last_attempted_at: null,
    reminder_last_error: null,
    reminder_lease_stage: null,
    reminder_lease_started_at: null,
    expiry_slack_notified_at: null,
    expiry_founder_email_sent_at: null,
    ...overrides,
  };
}

export type FakeOperatorRow = { id: string; email: string; first_name: string | null; last_name: string | null; account_activated_at: string | null };
export type FakeClaimRow = { id: string; venue_id: string | null };
export type FakeSubmissionRow = { id: string; venue_id: string | null };
export type FakeVenueRow = { id: string; name: string };
export type FakeNoteRow = Record<string, unknown> & { id: string; event_key: string | null };

type Row = Record<string, unknown>;
type FilterOp = "eq" | "is" | "not_is" | "lt" | "lte";
type Filter = { col: string; op: FilterOp; val: unknown };

function matchesRow(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = row[f.col];
    switch (f.op) {
      case "eq":
        return v === f.val;
      case "is":
        return v === f.val;
      case "not_is":
        return v !== f.val;
      case "lt":
        return (v as string | number) < (f.val as string | number);
      case "lte":
        return (v as string | number) <= (f.val as string | number);
      default:
        return false;
    }
  });
}

function makeSelectBuilder(getRows: () => Row[]) {
  const filters: Filter[] = [];
  const inFilters: { col: string; vals: unknown[] }[] = [];
  let orderCol: string | null = null;
  let orderAsc = true;
  let limitN: number | null = null;

  const matchesAll = (row: Row) => matchesRow(row, filters) && inFilters.every((f) => f.vals.includes(row[f.col]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    eq(col: string, val: unknown) {
      filters.push({ col, op: "eq", val });
      return builder;
    },
    is(col: string, val: unknown) {
      filters.push({ col, op: "is", val });
      return builder;
    },
    not(col: string, op: string, val: unknown) {
      if (op !== "is") throw new Error(`fake client: unsupported not(${col}, ${op}, ${val})`);
      filters.push({ col, op: "not_is", val });
      return builder;
    },
    lt(col: string, val: unknown) {
      filters.push({ col, op: "lt", val });
      return builder;
    },
    lte(col: string, val: unknown) {
      filters.push({ col, op: "lte", val });
      return builder;
    },
    in(col: string, vals: unknown[]) {
      inFilters.push({ col, vals });
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col;
      orderAsc = opts?.ascending !== false;
      return builder;
    },
    limit(n: number) {
      limitN = n;
      return builder;
    },
    maybeSingle: async () => {
      const rows = getRows().filter(matchesAll);
      return { data: rows[0] ? { ...rows[0] } : null, error: null };
    },
    then(onfulfilled?: (v: { data: Row[]; error: null }) => unknown, onrejected?: (e: unknown) => unknown) {
      let rows = getRows().filter(matchesAll);
      if (orderCol) {
        const col = orderCol;
        rows = [...rows].sort((a, b) => {
          const av = a[col] as string | number;
          const bv = b[col] as string | number;
          return av < bv ? -1 : av > bv ? 1 : 0;
        });
        if (!orderAsc) rows.reverse();
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(onfulfilled, onrejected);
    },
  };
  return builder;
}

function makeUpdateBuilder(getRows: () => Row[], patch: Row) {
  const filters: Filter[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    eq(col: string, val: unknown) {
      filters.push({ col, op: "eq", val });
      return builder;
    },
    is(col: string, val: unknown) {
      filters.push({ col, op: "is", val });
      return builder;
    },
    not(col: string, op: string, val: unknown) {
      if (op !== "is") throw new Error("fake client: unsupported not() on update");
      filters.push({ col, op: "not_is", val });
      return builder;
    },
    lt(col: string, val: unknown) {
      filters.push({ col, op: "lt", val });
      return builder;
    },
    lte(col: string, val: unknown) {
      filters.push({ col, op: "lte", val });
      return builder;
    },
    select() {
      const matched = getRows().filter((r) => matchesRow(r, filters));
      for (const row of matched) Object.assign(row, patch);
      return {
        maybeSingle: async () => ({ data: matched[0] ? { ...matched[0] } : null, error: null }),
        then(onfulfilled?: (v: { data: Row[]; error: null }) => unknown, onrejected?: (e: unknown) => unknown) {
          return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null }).then(onfulfilled, onrejected);
        },
      };
    },
    then(onfulfilled?: (v: { data: null; error: null }) => unknown, onrejected?: (e: unknown) => unknown) {
      const matched = getRows().filter((r) => matchesRow(r, filters));
      for (const row of matched) Object.assign(row, patch);
      return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
    },
  };
  return builder;
}

function makeInsert(getRows: () => Row[], obj: Row) {
  const eventKey = (obj.event_key as string | null) ?? null;
  if (eventKey !== null && getRows().some((r) => r.event_key === eventKey)) {
    return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } });
  }
  const row = { id: `note-${getRows().length + 1}-${Math.random().toString(36).slice(2, 7)}`, ...obj };
  getRows().push(row);
  return Promise.resolve({ data: row, error: null });
}

export function createFakeActivationReminderClient(
  seed: {
    lifecycles: FakeLifecycleRow[];
    operators: FakeOperatorRow[];
    claims?: FakeClaimRow[];
    submissions?: FakeSubmissionRow[];
    venues?: FakeVenueRow[];
  },
  /**
   * Test-only instrumentation: invoked every time
   * `.from("operator_activation_lifecycles").select(...)` is called,
   * BEFORE the builder is returned, with the 1-based call index. Lets a
   * test simulate a concurrent mutation landing between two reads the
   * orchestrator makes within a single invocation (e.g. "an extension
   * changes deadline_at between the lease claim and the pre-send
   * validation re-read") without needing genuine async interleaving.
   */
  hooks?: { onLifecycleSelect?: (callIndex: number, lifecycles: FakeLifecycleRow[]) => void }
) {
  const lifecycles: Row[] = seed.lifecycles as unknown as Row[];
  const operators: Row[] = seed.operators as unknown as Row[];
  const claims: Row[] = (seed.claims ?? []) as unknown as Row[];
  const submissions: Row[] = (seed.submissions ?? []) as unknown as Row[];
  const venues: Row[] = (seed.venues ?? []) as unknown as Row[];
  const venueClaimNotes: Row[] = [];
  const operatorSubmissionNotes: Row[] = [];
  let lifecycleSelectCallCount = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      switch (table) {
        case "operator_activation_lifecycles":
          return {
            select: () => {
              lifecycleSelectCallCount++;
              hooks?.onLifecycleSelect?.(lifecycleSelectCallCount, lifecycles as unknown as FakeLifecycleRow[]);
              return makeSelectBuilder(() => lifecycles);
            },
            update: (patch: Row) => makeUpdateBuilder(() => lifecycles, patch),
          };
        case "operators":
          return { select: () => makeSelectBuilder(() => operators) };
        case "venue_claims":
          return { select: () => makeSelectBuilder(() => claims) };
        case "operator_submissions":
          return { select: () => makeSelectBuilder(() => submissions) };
        case "venues":
          return { select: () => makeSelectBuilder(() => venues) };
        case "venue_claim_notes":
          return { insert: (obj: Row) => makeInsert(() => venueClaimNotes, obj) };
        case "operator_submission_notes":
          return { insert: (obj: Row) => makeInsert(() => operatorSubmissionNotes, obj) };
        default:
          throw new Error(`fake client: unexpected table "${table}"`);
      }
    },
  };

  return {
    client,
    lifecycles: lifecycles as unknown as FakeLifecycleRow[],
    operators: operators as unknown as FakeOperatorRow[],
    venueClaimNotes,
    operatorSubmissionNotes,
  };
}
