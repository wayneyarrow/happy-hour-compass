/**
 * Minimal in-memory `operators` table for the setup-contact store
 * (setupContactStore.ts): select(...).eq().maybeSingle(), and
 * update(patch).eq()/.is() with guarded-CAS semantics returning the matched
 * rows from .select(). Timestamps can optionally be stored in PostgREST's
 * "+00:00" format to prove nothing compares timestamptz values as text.
 */

type Row = Record<string, unknown>;

export type FakeOperatorContactRow = {
  id: string;
  email: string;
  account_activated_at: string | null;
  last_setup_contact_at: string | null;
  last_setup_contact_kind: string | null;
  last_setup_pause_at: string | null;
  last_milestone_contact_at: string | null;
  last_milestone_contact_status: string | null;
  setup_contact_claimed_at: string | null;
  setup_contact_claim_kind: string | null;
};

export function makeOperatorContactRow(overrides: Partial<FakeOperatorContactRow> & { id: string }): FakeOperatorContactRow {
  return {
    email: `${overrides.id}@venue.example`,
    account_activated_at: null,
    last_setup_contact_at: null,
    last_setup_contact_kind: null,
    last_setup_pause_at: null,
    last_milestone_contact_at: null,
    last_milestone_contact_status: null,
    setup_contact_claimed_at: null,
    setup_contact_claim_kind: null,
    ...overrides,
  };
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string" && /T\d/.test(a) && /T\d/.test(b)) {
    return new Date(a).getTime() === new Date(b).getTime(); // SQL compares timestamptz as instants
  }
  return a === b;
}

export function createFakeOperatorsContactClient(rows: FakeOperatorContactRow[], opts: { postgrestTimestamps?: boolean; failReads?: boolean } = {}) {
  const writes: Row[] = [];
  const normalize = (patch: Row): Row => {
    if (!opts.postgrestTimestamps) return patch;
    const out: Row = {};
    for (const [k, v] of Object.entries(patch)) out[k] = typeof v === "string" && ISO_Z.test(v) ? v.replace(/Z$/, "+00:00") : v;
    return out;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    from(table: string) {
      if (table !== "operators") throw new Error(`fake operators client: unexpected table ${table}`);
      return {
        select() {
          const filters: [string, unknown][] = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b: any = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return b;
            },
            async maybeSingle() {
              if (opts.failReads) return { data: null, error: { message: "read failed" } };
              const r = (rows as unknown as Row[]).find((row) => filters.every(([c, v]) => sameValue(row[c], v)));
              return { data: r ? { ...r } : null, error: null };
            },
          };
          return b;
        },
        update(patch: Row) {
          const filters: ((r: Row) => boolean)[] = [];
          const apply = () => {
            const matched = (rows as unknown as Row[]).filter((r) => filters.every((f) => f(r)));
            for (const r of matched) Object.assign(r, normalize(patch));
            if (matched.length) writes.push(patch);
            return matched.map((r) => ({ ...r }));
          };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b: any = {
            eq(col: string, val: unknown) {
              filters.push((r) => sameValue(r[col], val));
              return b;
            },
            is(col: string, val: null) {
              filters.push((r) => r[col] === val || r[col] === undefined);
              return b;
            },
            async select() {
              return { data: apply(), error: null };
            },
            then(onfulfilled: (v: { data: null; error: null }) => unknown) {
              apply();
              return Promise.resolve({ data: null, error: null }).then(onfulfilled);
            },
          };
          return b;
        },
      };
    },
  };
  return { client, rows, writes };
}
