/**
 * In-memory stand-in for the slice of Supabase (createAdminClient()) that
 * releaseActivationLifecycleImpl() touches: operator_activation_lifecycles,
 * operators, venue_claims, operator_submissions, venues,
 * venue_claim_notes, operator_submission_notes. Mirrors the established
 * fakeActivationReminderClient.ts convention (same guarded-CAS .update()
 * semantics as a real Postgres UPDATE ... WHERE ... RETURNING, same
 * event_key partial-unique-index simulation on insert) — extended here to
 * additionally support a guarded .update() on `venues`, which the Phase
 * 2A-3 reminder worker's fixture never needed.
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
  reminder_lease_started_at: string | null;
};

export function makeLifecycleRow(overrides: Partial<FakeLifecycleRow> & { id: string; operator_id: string }): FakeLifecycleRow {
  return {
    origin_type: "submission",
    origin_claim_id: null,
    origin_submission_id: "sub-1",
    started_at: "2026-09-01T00:00:00.000Z",
    deadline_at: "2026-09-15T00:00:00.000Z",
    reminder_stage: 0,
    expired_at: null,
    released_at: null,
    reminder_lease_started_at: null,
    ...overrides,
  };
}

export type FakeOperatorRow = { id: string; account_activated_at: string | null };
export type FakeClaimRow = { id: string; venue_id: string | null };
export type FakeSubmissionRow = { id: string; venue_id: string | null };
export type FakeVenueRow = { id: string; created_by_operator_id: string | null; claimed_by: string | null; claimed_at: string | null; is_verified: boolean; is_published: boolean };
export type FakeNoteRow = Record<string, unknown> & { id: string; event_key: string | null };

type Row = Record<string, unknown>;
type FilterOp = "eq" | "is";
type Filter = { col: string; op: FilterOp; val: unknown };

function matchesRow(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => row[f.col] === f.val);
}

function makeSelectBuilder(getRows: () => Row[]) {
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
    maybeSingle: async () => {
      const rows = getRows().filter((r) => matchesRow(r, filters));
      return { data: rows[0] ? { ...rows[0] } : null, error: null };
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
    select() {
      const matched = getRows().filter((r) => matchesRow(r, filters));
      for (const row of matched) Object.assign(row, patch);
      return {
        maybeSingle: async () => ({ data: matched[0] ? { ...matched[0] } : null, error: null }),
      };
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

export function createFakeActivationReleaseClient(
  seed: {
    lifecycles: FakeLifecycleRow[];
    operators: FakeOperatorRow[];
    claims?: FakeClaimRow[];
    submissions?: FakeSubmissionRow[];
    venues?: FakeVenueRow[];
  },
  /**
   * Test-only instrumentation, mirroring fakeActivationReminderClient.ts's
   * onLifecycleSelect hook: invoked with a 1-based call index every time
   * `.from("operator_activation_lifecycles"|"operators"|"venues").select(...)`
   * is called, BEFORE the builder is returned — lets a test simulate a
   * concurrent mutation (an extend, an activation, an ownership change)
   * landing between two reads the impl makes within one invocation, without
   * genuine async interleaving.
   */
  hooks?: {
    onLifecycleSelect?: (callIndex: number, lifecycles: FakeLifecycleRow[]) => void;
    onOperatorSelect?: (callIndex: number, operators: FakeOperatorRow[]) => void;
    onVenueSelect?: (callIndex: number, venues: FakeVenueRow[]) => void;
  }
) {
  const lifecycles: Row[] = seed.lifecycles as unknown as Row[];
  const operators: Row[] = seed.operators as unknown as Row[];
  const claims: Row[] = (seed.claims ?? []) as unknown as Row[];
  const submissions: Row[] = (seed.submissions ?? []) as unknown as Row[];
  const venues: Row[] = (seed.venues ?? []) as unknown as Row[];
  const venueClaimNotes: Row[] = [];
  const operatorSubmissionNotes: Row[] = [];
  let lifecycleSelectCallCount = 0;
  let operatorSelectCallCount = 0;
  let venueSelectCallCount = 0;

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
          return {
            select: () => {
              operatorSelectCallCount++;
              hooks?.onOperatorSelect?.(operatorSelectCallCount, operators as unknown as FakeOperatorRow[]);
              return makeSelectBuilder(() => operators);
            },
          };
        case "venue_claims":
          return { select: () => makeSelectBuilder(() => claims) };
        case "operator_submissions":
          return { select: () => makeSelectBuilder(() => submissions) };
        case "venues":
          return {
            select: () => {
              venueSelectCallCount++;
              hooks?.onVenueSelect?.(venueSelectCallCount, venues as unknown as FakeVenueRow[]);
              return makeSelectBuilder(() => venues);
            },
            update: (patch: Row) => makeUpdateBuilder(() => venues, patch),
          };
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
    venues: venues as unknown as FakeVenueRow[],
    venueClaimNotes,
    operatorSubmissionNotes,
  };
}
