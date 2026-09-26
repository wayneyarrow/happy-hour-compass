/**
 * In-memory stand-in for the three tables and three migration-100
 * functions the email-code activation flow touches.
 *
 * FIDELITY: each fake RPC mirrors its SQL counterpart's check order and
 * writes (100_operator_email_code_verification_foundation.sql) and runs
 * with no await inside — so, like the real function under its lifecycle
 * row lock, two concurrent calls can never interleave. That is what lets
 * the concurrency tests (double resend, double verify) prove the
 * APPLICATION code relies on the database outcome rather than its own
 * pre-checks. It does not prove Postgres itself serializes the real
 * functions (that is the FOR UPDATE lock, pinned by the migration's own
 * tests); no test here touches a real database, email provider, or Slack.
 */

type Row = Record<string, unknown>;

export type FakeEmailCodeDbOptions = {
  now: () => Date;
  failTables?: string[];
  failRpc?: string[];
};

export type FakeLifecycleSeed = {
  id: string;
  operator_id: string;
  origin_type?: "claim" | "submission";
  started_at?: string;
  deadline_at: string;
  expired_at?: string | null;
  released_at?: string | null;
  verification_required: boolean;
  verification_completed_at?: string | null;
  reminder_stage?: number;
};

export function makeFakeEmailCodeDb(options: FakeEmailCodeDbOptions) {
  const tables: Record<string, Row[]> = {
    operator_activation_lifecycles: [],
    operators: [],
    operator_verification_codes: [],
  };
  const failTables = new Set(options.failTables ?? []);
  const failRpc = new Set(options.failRpc ?? []);
  const rpcCalls: { name: string; args: Row }[] = [];
  const generateLinkCalls: Row[] = [];
  let tableReads = 0;
  let nextCode = 1;

  class Query implements PromiseLike<{ data: Row[] | null; error: { message: string } | null }> {
    private filters: ((r: Row) => boolean)[] = [];
    private orderSpec: { col: string; asc: boolean } | null = null;
    private limitN: number | null = null;
    constructor(private table: string) {}
    select() {
      return this;
    }
    eq(col: string, value: unknown) {
      this.filters.push((r) => r[col] === value);
      return this;
    }
    is(col: string, value: unknown) {
      this.filters.push((r) => (r[col] ?? null) === value);
      return this;
    }
    gt(col: string, value: string) {
      this.filters.push((r) => String(r[col]) > value);
      return this;
    }
    order(col: string, { ascending }: { ascending: boolean }) {
      this.orderSpec = { col, asc: ascending };
      return this;
    }
    limit(n: number) {
      this.limitN = n;
      return this;
    }
    private rows(): Row[] {
      let rows = (tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
      if (this.orderSpec) {
        const { col, asc } = this.orderSpec;
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
      }
      if (this.limitN !== null) rows = rows.slice(0, this.limitN);
      return rows.map((r) => ({ ...r }));
    }
    async maybeSingle() {
      tableReads++;
      if (failTables.has(this.table)) return { data: null, error: { message: `${this.table} read failed` } };
      const rows = this.rows();
      if (rows.length > 1) return { data: null, error: { message: "multiple rows" } };
      return { data: rows[0] ?? null, error: null };
    }
    then<T1 = { data: Row[] | null; error: { message: string } | null }, T2 = never>(
      onFulfilled?: ((value: { data: Row[] | null; error: { message: string } | null }) => T1 | PromiseLike<T1>) | null,
      onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
    ): PromiseLike<T1 | T2> {
      tableReads++;
      const result = failTables.has(this.table)
        ? { data: null, error: { message: `${this.table} read failed` } }
        : { data: this.rows(), error: null };
      return Promise.resolve(result).then(onFulfilled, onRejected);
    }
  }

  const iso = (d: Date) => d.toISOString();
  const lifecycleById = (id: unknown) => tables.operator_activation_lifecycles.find((l) => l.id === id);
  const activatedAt = (l: Row) => tables.operators.find((o) => o.id === l.operator_id)?.account_activated_at ?? null;
  const codesFor = (lifecycleId: unknown) => tables.operator_verification_codes.filter((c) => c.lifecycle_id === lifecycleId);

  /** Shared lifecycle eligibility, in the migration's order. */
  function lifecycleIneligible(l: Row | undefined, now: Date): string | null {
    if (!l) return "lifecycle_not_found";
    if (l.released_at || l.expired_at || new Date(l.deadline_at as string).getTime() <= now.getTime()) return "lifecycle_closed";
    if (activatedAt(l)) return "already_activated";
    if (l.verification_required !== true) return "verification_not_required";
    if (l.verification_completed_at) return "already_verified";
    return null;
  }

  function currentCodeCheck(l: Row, codeId: unknown, now: Date): { code?: Row; outcome?: string } {
    const code = tables.operator_verification_codes.find((c) => c.id === codeId && c.lifecycle_id === l.id);
    if (!code || code.consumed_at || code.superseded_at) return { outcome: "code_not_current" };
    if (now.getTime() >= new Date(code.expires_at as string).getTime()) return { outcome: "code_expired" };
    if ((code.attempt_count as number) >= (code.max_attempts as number)) return { outcome: "code_exhausted" };
    return { code };
  }

  const rpcImpls: Record<string, (args: Row) => Row> = {
    issue_operator_verification_code(args) {
      if (typeof args.p_code_digest !== "string" || !/^[0-9a-f]{64}$/.test(args.p_code_digest)) {
        throw new Error("invalid code digest");
      }
      const now = options.now();
      const l = lifecycleById(args.p_lifecycle_id);
      const bad = lifecycleIneligible(l, now);
      if (bad) return { outcome: bad, code_id: null, code_expires_at: null, resend_available_at: null };
      const issued = codesFor(l!.id).map((c) => new Date(c.issued_at as string).getTime());
      const last = issued.length ? Math.max(...issued) : null;
      if (last !== null && now.getTime() < last + 60_000) {
        return { outcome: "cooldown", code_id: null, code_expires_at: null, resend_available_at: iso(new Date(last + 60_000)) };
      }
      const inWindow = issued.filter((ms) => ms > now.getTime() - 3_600_000);
      if (inWindow.length >= 5) {
        return {
          outcome: "rate_limited",
          code_id: null,
          code_expires_at: null,
          resend_available_at: iso(new Date(Math.min(...inWindow) + 3_600_000)),
        };
      }
      for (const c of codesFor(l!.id)) if (!c.consumed_at && !c.superseded_at) c.superseded_at = iso(now);
      const row = {
        id: `00000000-0000-4000-8000-${String(nextCode++).padStart(12, "0")}`,
        lifecycle_id: l!.id,
        code_digest: args.p_code_digest,
        issued_at: iso(now),
        expires_at: iso(new Date(now.getTime() + 600_000)),
        attempt_count: 0,
        max_attempts: 5,
        consumed_at: null,
        superseded_at: null,
        request_ip: args.p_request_ip ?? null,
      };
      tables.operator_verification_codes.push(row);
      return { outcome: "issued", code_id: row.id, code_expires_at: row.expires_at, resend_available_at: iso(new Date(now.getTime() + 60_000)) };
    },
    record_operator_verification_code_failure(args) {
      const now = options.now();
      const l = lifecycleById(args.p_lifecycle_id);
      const bad = lifecycleIneligible(l, now);
      if (bad) return { outcome: bad, attempts_remaining: null };
      const { code, outcome } = currentCodeCheck(l!, args.p_code_id, now);
      if (!code) return { outcome, attempts_remaining: outcome === "code_exhausted" ? 0 : null };
      code.attempt_count = (code.attempt_count as number) + 1;
      return { outcome: "incorrect", attempts_remaining: (code.max_attempts as number) - (code.attempt_count as number) };
    },
    consume_operator_verification_code(args) {
      const now = options.now();
      const l = lifecycleById(args.p_lifecycle_id);
      const bad = lifecycleIneligible(l, now);
      if (bad) return { outcome: bad, verified_at: null };
      const { code, outcome } = currentCodeCheck(l!, args.p_code_id, now);
      if (!code) return { outcome, verified_at: null };
      code.consumed_at = iso(now);
      l!.verification_completed_at = iso(now);
      return { outcome: "verified", verified_at: iso(now) };
    },
  };

  const client = {
    from: (table: string) => new Query(table),
    async rpc(name: string, args: Row) {
      rpcCalls.push({ name, args: { ...args } });
      if (failRpc.has(name)) return { data: null, error: { message: `${name} failed` } };
      return { data: [rpcImpls[name](args)], error: null };
    },
    auth: {
      admin: {
        async generateLink(params: Row) {
          generateLinkCalls.push(params);
          return {
            data: { properties: { hashed_token: `hashed-${generateLinkCalls.length}`, action_link: "https://supabase.example/auth/v1/verify?token=legacy" } },
            error: null,
          };
        },
        createUser() {
          throw new Error("createUser must never be called by the email-code flow");
        },
      },
    },
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    tables,
    rpcCalls,
    generateLinkCalls,
    tableReads: () => tableReads,
    seedOperator(row: { id: string; email: string; first_name?: string | null; account_activated_at?: string | null }) {
      tables.operators.push({ first_name: null, account_activated_at: null, ...row });
    },
    seedLifecycle(row: FakeLifecycleSeed) {
      tables.operator_activation_lifecycles.push({
        origin_type: "claim",
        started_at: "2026-09-20T00:00:00.000Z",
        expired_at: null,
        released_at: null,
        verification_completed_at: null,
        reminder_stage: 0,
        ...row,
      });
    },
  };
}

/** A client that fails the test on ANY access — proves a code path performs zero reads/writes. */
export function untouchableClient() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Proxy({} as any, {
    get(_target, prop) {
      throw new Error(`untouchable client accessed: ${String(prop)}`);
    },
  });
}
