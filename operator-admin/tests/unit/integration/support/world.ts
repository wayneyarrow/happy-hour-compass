import { randomUUID } from "node:crypto";

/**
 * In-memory stand-in for everything OUTSIDE the application process that
 * the operator-onboarding journey touches: the Supabase database (PostgREST
 * query builder + migration-100 functions), Supabase Auth (admin API and
 * the cookie-session client), Resend, Slack, Turnstile, Google Places, and
 * the Next.js request (headers/cookies).
 *
 * Everything INSIDE the application — server actions, orchestration,
 * provisioning, lifecycle, email-code service, templates, the verify page
 * — runs for real against this world (see installBoundaryFakes.ts).
 *
 * FIDELITY NOTES
 *  - Tables enforce the unique constraints the journey relies on:
 *    operators(id, email), one LIVE lifecycle per operator (migration 098's
 *    partial unique index), one lifecycle per origin, auth users by email,
 *    and notes' event_key (migration 099).
 *  - The three migration-100 functions mirror the SQL's check order and
 *    writes; each runs with no await inside, so — like the real function
 *    under its lifecycle row lock — calls never interleave.
 *  - RLS, triggers (e.g. the owner-membership row Production creates with
 *    each operator) and real Postgres serialization are NOT modelled.
 */

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

export type SentEmail = { from?: string; to: string; subject: string; html: string; text: string; idempotencyKey?: string };
export type SlackPost = { kind: "alert" | "acquisition"; channel?: string; title?: string; message?: string; text?: string };

function freshState() {
  return {
    tables: {
      operators: [] as Row[],
      venues: [] as Row[],
      operator_submissions: [] as Row[],
      operator_submission_notes: [] as Row[],
      venue_claims: [] as Row[],
      venue_claim_notes: [] as Row[],
      operator_activation_lifecycles: [] as Row[],
      operator_verification_codes: [] as Row[],
      operator_memberships: [] as Row[],
      markets: [] as Row[],
      cities: [] as Row[],
    } as Record<string, Row[]>,
    authUsers: [] as Row[],
    emails: [] as SentEmail[],
    slack: [] as SlackPost[],
    generateLinkCalls: [] as Row[],
    createUserCalls: [] as Row[],
    rpcCalls: [] as { name: string; args: Row }[],
    /** hashed_token → user id, for links generated but not yet exchanged. */
    pendingRecoveryTokens: new Map<string, string>(),
    /** The browser's Supabase session (set by a server-side verifyOtp exchange). */
    sessionUserId: null as string | null,
    /** access token → user id, for completeAccountSetupAction(accessToken). */
    accessTokens: new Map<string, string>(),
    cookies: new Map<string, { value: string; options?: Row }>(),
    requestHeaders: new Map<string, string>(),
    now: () => new Date(),
    // Controlled external outcomes
    turnstileOk: true,
    googleCandidate: null as Row | null,
    emailSendFails: false,
    failRpc: new Set<string>(),
    createUserFailsWith: null as string | null,
  };
}

export const world = freshState();

export function resetWorld(overrides: Partial<ReturnType<typeof freshState>> = {}) {
  Object.assign(world, freshState(), overrides);
}

// ── PostgREST-like query builder ─────────────────────────────────────────────

function uniqueViolation(detail: string): Result {
  return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint (${detail})` } };
}

// Postgres stamps each INSERT with its own (microsecond) now(); ms-resolution
// Date values would tie within one request and make created_at ordering
// meaningless. Keep insert timestamps strictly increasing instead.
let lastInsertMs = 0;
function insertTimestamp(): string {
  lastInsertMs = Math.max(world.now().getTime(), lastInsertMs + 1);
  return new Date(lastInsertMs).toISOString();
}

function applyInsertDefaults(table: string, row: Row): Row {
  const now = insertTimestamp();
  const base: Row = { id: row.id ?? randomUUID(), created_at: now, ...row };
  if (table === "operators") return { account_activated_at: null, ...base };
  if (table === "operator_activation_lifecycles") {
    return {
      expired_at: null,
      released_at: null,
      verification_required: false,
      verification_completed_at: null,
      reminder_next_attempt_at: null,
      reminder_attempt_count: 0,
      reminder_last_attempted_at: null,
      reminder_last_error: null,
      reminder_lease_stage: null,
      reminder_lease_started_at: null,
      ...base,
    };
  }
  if (table === "operator_submissions") return { submitted_at: now, ...base };
  return base;
}

function checkUnique(table: string, row: Row): Result | null {
  const rows = world.tables[table];
  if (rows.some((r) => r.id === row.id)) return uniqueViolation(`${table}_pkey`);
  if (table === "operators" && rows.some((r) => r.email === row.email)) return uniqueViolation("operators_email_key");
  // venue_claims_one_pending_per_venue_idx: unique (venue_id) WHERE status = 'pending'.
  if (table === "venue_claims" && row.status === "pending" && rows.some((r) => r.venue_id === row.venue_id && r.status === "pending")) {
    return uniqueViolation("venue_claims_one_pending_per_venue_idx");
  }
  // migration 099: partial unique index on event_key (WHERE event_key IS NOT NULL) on both notes tables.
  if ((table === "venue_claim_notes" || table === "operator_submission_notes") && row.event_key != null && rows.some((r) => r.event_key === row.event_key)) {
    return uniqueViolation(`${table}_event_key_uidx`);
  }
  if (table === "operator_activation_lifecycles") {
    const live = (r: Row) => r.expired_at == null && r.released_at == null;
    if (live(row) && rows.some((r) => r.operator_id === row.operator_id && live(r))) {
      return uniqueViolation("operator_activation_lifecycles_one_live_per_operator_uidx");
    }
    if (row.origin_submission_id && rows.some((r) => r.origin_submission_id === row.origin_submission_id)) {
      return uniqueViolation("one lifecycle per submission origin");
    }
    if (row.origin_claim_id && rows.some((r) => r.origin_claim_id === row.origin_claim_id)) {
      return uniqueViolation("one lifecycle per claim origin");
    }
  }
  return null;
}

class Query implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private orderSpec: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private countMode = false;
  private headOnly = false;

  constructor(private table: string) {
    if (!world.tables[table]) world.tables[table] = [];
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => r[col] !== v);
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (r[col] ?? null) === v);
    return this;
  }
  not(col: string, op: string, v: unknown) {
    if (op === "is") this.filters.push((r) => (r[col] ?? null) !== v);
    else throw new Error(`fake not(${op}) unsupported`);
    return this;
  }
  gt(col: string, v: string) {
    this.filters.push((r) => String(r[col]) > v);
    return this;
  }
  gte(col: string, v: string) {
    this.filters.push((r) => String(r[col]) >= v);
    return this;
  }
  lt(col: string, v: string) {
    this.filters.push((r) => String(r[col]) < v);
    return this;
  }
  lte(col: string, v: string) {
    this.filters.push((r) => String(r[col]) <= v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  ilike(col: string, pattern: string) {
    const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderSpec = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }

  private matching(): Row[] {
    return world.tables[this.table].filter((r) => this.filters.every((f) => f(r)));
  }

  /** Executes the operation once and returns affected/selected rows. */
  private run(): Result {
    const rows = world.tables[this.table];
    if (this.op === "insert") {
      const inputs = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const inserted: Row[] = [];
      for (const input of inputs) {
        const row = applyInsertDefaults(this.table, input);
        const conflict = checkUnique(this.table, row);
        if (conflict) return conflict;
        rows.push(row);
        inserted.push(row);
      }
      return { data: inserted.map((r) => ({ ...r })), error: null };
    }
    if (this.op === "update") {
      const hits = this.matching();
      for (const r of hits) Object.assign(r, this.payload);
      return { data: hits.map((r) => ({ ...r })), error: null };
    }
    if (this.op === "delete") {
      const hits = new Set(this.matching());
      world.tables[this.table] = rows.filter((r) => !hits.has(r));
      return { data: [...hits].map((r) => ({ ...r })), error: null };
    }
    let out = this.matching();
    if (this.orderSpec) {
      const { col, asc } = this.orderSpec;
      out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    if (this.countMode) return { data: this.headOnly ? null : out.map((r) => ({ ...r })), error: null, count: out.length };
    return { data: out.map((r) => ({ ...r })), error: null };
  }

  async single(): Promise<Result> {
    const res = this.run();
    if (res.error) return res;
    const rows = res.data as Row[];
    if (rows.length !== 1) return { data: null, error: { code: "PGRST116", message: `expected 1 row, got ${rows.length}` } };
    return { data: rows[0], error: null };
  }
  async maybeSingle(): Promise<Result> {
    const res = this.run();
    if (res.error) return res;
    const rows = res.data as Row[];
    if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
    return { data: rows[0] ?? null, error: null };
  }
  then<T1 = Result, T2 = never>(
    onFulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }
}

// ── Migration-100 functions ──────────────────────────────────────────────────

const iso = (d: Date) => d.toISOString();
const lifecycles = () => world.tables.operator_activation_lifecycles;
const codes = () => world.tables.operator_verification_codes;

function lifecycleIneligible(l: Row | undefined, now: Date): string | null {
  if (!l) return "lifecycle_not_found";
  if (l.released_at || l.expired_at || new Date(l.deadline_at as string).getTime() <= now.getTime()) return "lifecycle_closed";
  if (world.tables.operators.find((o) => o.id === l.operator_id)?.account_activated_at) return "already_activated";
  if (l.verification_required !== true) return "verification_not_required";
  if (l.verification_completed_at) return "already_verified";
  return null;
}

function currentCode(l: Row, codeId: unknown, now: Date): { code?: Row; outcome?: string } {
  const code = codes().find((c) => c.id === codeId && c.lifecycle_id === l.id);
  if (!code || code.consumed_at || code.superseded_at) return { outcome: "code_not_current" };
  if (now.getTime() >= new Date(code.expires_at as string).getTime()) return { outcome: "code_expired" };
  if ((code.attempt_count as number) >= (code.max_attempts as number)) return { outcome: "code_exhausted" };
  return { code };
}

const rpcImpls: Record<string, (a: Row) => Row> = {
  issue_operator_verification_code(a) {
    if (typeof a.p_code_digest !== "string" || !/^[0-9a-f]{64}$/.test(a.p_code_digest)) throw new Error("invalid code digest");
    const now = world.now();
    const l = lifecycles().find((x) => x.id === a.p_lifecycle_id);
    const bad = lifecycleIneligible(l, now);
    if (bad) return { outcome: bad, code_id: null, code_expires_at: null, resend_available_at: null };
    const issued = codes().filter((c) => c.lifecycle_id === l!.id).map((c) => new Date(c.issued_at as string).getTime());
    const last = issued.length ? Math.max(...issued) : null;
    if (last !== null && now.getTime() < last + 60_000) {
      return { outcome: "cooldown", code_id: null, code_expires_at: null, resend_available_at: iso(new Date(last + 60_000)) };
    }
    const inWindow = issued.filter((ms) => ms > now.getTime() - 3_600_000);
    if (inWindow.length >= 5) {
      return { outcome: "rate_limited", code_id: null, code_expires_at: null, resend_available_at: iso(new Date(Math.min(...inWindow) + 3_600_000)) };
    }
    for (const c of codes()) if (c.lifecycle_id === l!.id && !c.consumed_at && !c.superseded_at) c.superseded_at = iso(now);
    const row: Row = {
      id: randomUUID(),
      lifecycle_id: l!.id,
      code_digest: a.p_code_digest,
      issued_at: iso(now),
      expires_at: iso(new Date(now.getTime() + 600_000)),
      attempt_count: 0,
      max_attempts: 5,
      consumed_at: null,
      superseded_at: null,
      request_ip: a.p_request_ip ?? null,
      created_at: iso(now),
    };
    codes().push(row);
    return { outcome: "issued", code_id: row.id, code_expires_at: row.expires_at, resend_available_at: iso(new Date(now.getTime() + 60_000)) };
  },
  record_operator_verification_code_failure(a) {
    const now = world.now();
    const l = lifecycles().find((x) => x.id === a.p_lifecycle_id);
    const bad = lifecycleIneligible(l, now);
    if (bad) return { outcome: bad, attempts_remaining: null };
    const { code, outcome } = currentCode(l!, a.p_code_id, now);
    if (!code) return { outcome, attempts_remaining: outcome === "code_exhausted" ? 0 : null };
    code.attempt_count = (code.attempt_count as number) + 1;
    return { outcome: "incorrect", attempts_remaining: (code.max_attempts as number) - (code.attempt_count as number) };
  },
  consume_operator_verification_code(a) {
    const now = world.now();
    const l = lifecycles().find((x) => x.id === a.p_lifecycle_id);
    const bad = lifecycleIneligible(l, now);
    if (bad) return { outcome: bad, verified_at: null };
    const { code, outcome } = currentCode(l!, a.p_code_id, now);
    if (!code) return { outcome, verified_at: null };
    code.consumed_at = iso(now);
    l!.verification_completed_at = iso(now);
    return { outcome: "verified", verified_at: iso(now) };
  },
};

// ── Clients ──────────────────────────────────────────────────────────────────

/** Stand-in for createAdminClient(): service-role DB + Auth admin API. */
export function fakeAdminClient() {
  return {
    from: (table: string) => new Query(table),
    async rpc(name: string, args: Row) {
      world.rpcCalls.push({ name, args: { ...args } });
      if (world.failRpc.has(name)) return { data: null, error: { message: `${name} failed` } };
      const impl = rpcImpls[name];
      if (!impl) throw new Error(`fake rpc ${name} not implemented`);
      return { data: [impl(args)], error: null };
    },
    auth: {
      admin: {
        async createUser(params: { email: string; email_confirm?: boolean; user_metadata?: Row }) {
          world.createUserCalls.push({ ...params });
          if (world.createUserFailsWith) return { data: { user: null }, error: { message: world.createUserFailsWith } };
          if (world.authUsers.some((u) => u.email === params.email)) {
            return { data: { user: null }, error: { message: "A user with this email address has already been registered" } };
          }
          const user = { id: randomUUID(), email: params.email, email_confirmed_at: params.email_confirm ? iso(world.now()) : null, password: null };
          world.authUsers.push(user);
          return { data: { user }, error: null };
        },
        async generateLink(params: { type: string; email: string; options?: { redirectTo?: string } }) {
          world.generateLinkCalls.push({ ...params });
          const user = world.authUsers.find((u) => u.email === params.email);
          if (!user) return { data: null, error: { code: "user_not_found", message: "User not found" } };
          const hashed = `hashed-${randomUUID()}`;
          world.pendingRecoveryTokens.set(hashed, user.id as string);
          return {
            data: {
              user,
              properties: {
                hashed_token: hashed,
                action_link: `https://fakeproject.supabase.co/auth/v1/verify?token=${hashed}&type=${params.type}&redirect_to=${encodeURIComponent(params.options?.redirectTo ?? "")}`,
              },
            },
            error: null,
          };
        },
        async deleteUser(id: string) {
          world.authUsers = world.authUsers.filter((u) => u.id !== id);
          return { data: null, error: null };
        },
      },
    },
  };
}

/** Stand-in for the cookie-bound SSR client createClient(). */
export function fakeSessionClient() {
  return {
    from: (table: string) => new Query(table),
    auth: {
      async getUser(accessToken?: string) {
        const id = accessToken ? world.accessTokens.get(accessToken) ?? null : world.sessionUserId;
        const user = id ? world.authUsers.find((u) => u.id === id) ?? null : null;
        return { data: { user }, error: user ? null : { message: "no session" } };
      },
      async verifyOtp({ token_hash }: { type: string; token_hash: string }) {
        const userId = world.pendingRecoveryTokens.get(token_hash);
        if (!userId) return { data: { session: null }, error: { message: "Token has expired or is invalid" } };
        world.pendingRecoveryTokens.delete(token_hash); // single use
        world.sessionUserId = userId;
        world.cookies.set("sb-fakeproject-auth-token", { value: `session-for-${userId}` });
        return { data: { session: { user: { id: userId } } }, error: null };
      },
    },
  };
}
