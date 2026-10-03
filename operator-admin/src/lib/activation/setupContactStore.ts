import type { SupabaseClient } from "@supabase/supabase-js";
import {
  foldTarget,
  isClaimActive,
  type MilestoneContactStatus,
  type OperatorContactState,
  type SetupContactClaimKind,
  type SetupContactKind,
} from "@/lib/activation/setupContactPolicy";

/**
 * Persistence for setup-contact coordination (migration 104, public.operators).
 *
 * Every write is a compare-and-swap on the exact previously-read value
 * (never a blind overwrite), so concurrent writers can't lose each other's
 * evidence or steal a live claim. Recorders never throw: evidence is
 * best-effort from the sender's point of view (a failed write is logged),
 * but it is written by the sending code itself, not the email registry.
 *
 * LOCK ORDER (all try-locks — nothing ever waits, so there is no deadlock):
 *   reminder worker:   lifecycle reminder lease → operator contact claim
 *   milestone worker:  operator contact claim → milestone event claim
 *   Final resend/Copy: lifecycle setup_link_claimed_at → operator contact claim
 *   founder Resend:    operator contact claim
 *   Release:           takes no claim; refuses while either claim is active
 * Any failed acquisition releases what the caller already holds and returns
 * "still finishing" (founder) or retries on a later pass (workers). Founder
 * actions are exempt from the 48 h spacing rule, never from the claim.
 *
 * BOUNDED START: every holder sends inside runHoldingContactClaim()
 * (setupContactClaimGuard.ts), so its provider request starts within 20 s of
 * the claim. A started request is never abandoned (it can't be cancelled), so
 * the claim lives SETUP_CONTACT_CLAIM_TTL_MS (6 min) before it is folded and
 * replaced; initial setup emails queue rather than wait that long.
 *
 * SAFE RELEASE: a holder releases its claim only after its evidence write
 * succeeded, and only by CAS on its own token (an old request can never
 * clear a newer claim). If the evidence write failed, the claim is left to
 * go stale and is folded into evidence as a possible contact.
 */

type AdminClient = SupabaseClient;

const STATE_COLUMNS =
  "id, account_activated_at, last_setup_contact_at, last_setup_contact_kind, last_setup_pause_at, last_milestone_contact_at, last_milestone_contact_status, setup_contact_claimed_at, setup_contact_claim_kind";

type Row = Record<string, unknown>;

function toState(row: Row): OperatorContactState {
  return {
    operatorId: row.id as string,
    activated: !!row.account_activated_at,
    lastSetupContactAt: (row.last_setup_contact_at as string | null) ?? null,
    lastSetupContactKind: (row.last_setup_contact_kind as string | null) ?? null,
    lastSetupPauseAt: (row.last_setup_pause_at as string | null) ?? null,
    lastMilestoneContactAt: (row.last_milestone_contact_at as string | null) ?? null,
    lastMilestoneContactStatus: (row.last_milestone_contact_status as string | null) ?? null,
    claimedAt: (row.setup_contact_claimed_at as string | null) ?? null,
    claimKind: (row.setup_contact_claim_kind as string | null) ?? null,
  };
}

function isAfter(a: string, b: string | null): boolean {
  return b === null || new Date(a).getTime() > new Date(b).getTime();
}

/** The coordination surface the two workers use (injectable for tests). */
export type SetupContactCoordinator = {
  read(operatorId: string): Promise<OperatorContactState | null>;
  /** The UNACTIVATED operator who owns `email`, or null (none, or already activated). Throws on read failure. */
  findUnactivatedOperatorId(email: string): Promise<string | null>;
  /** Takes the operator's contact claim; returns the stored claim token, or null if another worker holds it. */
  claim(operatorId: string, kind: SetupContactClaimKind, now: Date): Promise<string | null>;
  /** Clears the claim only if it is still `token` (never someone else's). */
  release(operatorId: string, token: string): Promise<void>;
  /**
   * Records a milestone that was accepted or may have been accepted (only
   * while the operator is unactivated). Returns false only when the write
   * failed — the caller must then keep its claim so it is folded later.
   */
  recordMilestone(operatorId: string, at: Date, status: MilestoneContactStatus): Promise<boolean>;
  /** Records a setup email about to be sent by the claim holder. False only on write failure. */
  recordSetupContact(operatorId: string, kind: SetupContactKind, at: Date): Promise<boolean>;
  /** Records a Copy-setup-link pause. False only on write failure. */
  recordPause(operatorId: string, at: Date): Promise<boolean>;
  /**
   * Queues an initial setup email (migration 105) for the hourly worker to
   * send under the claim (deferredInitialSetup.ts). The LATEST request wins:
   * a newer request moves the timestamp forward (never back), so one that
   * arrives while an older one is being sent is never swallowed by the
   * worker clearing the older one. True once a request at or after `at` is
   * queued; false only when the write failed (the email is then neither
   * sent nor queued — the caller must report it).
   */
  deferInitialSetup(operatorId: string, at: Date): Promise<boolean>;
};

async function readState(admin: AdminClient, operatorId: string): Promise<OperatorContactState | null> {
  const { data, error } = await admin.from("operators").select(STATE_COLUMNS).eq("id", operatorId).maybeSingle();
  if (error) throw new Error(`operator contact state read failed: ${error.message}`);
  return data ? toState(data as Row) : null;
}

/**
 * Sets `column` to `at` (and optional extra columns) only if `at` is later
 * than the current value. CAS on the previously-read value; retried a few
 * times if a concurrent writer changed it in between.
 */
async function setIfLater(
  admin: AdminClient,
  operatorId: string,
  column: "last_setup_contact_at" | "last_setup_pause_at" | "last_milestone_contact_at" | "last_setup_email_accepted_at" | "initial_setup_deferred_at",
  at: string,
  extra: Record<string, unknown> = {},
  filters: { unactivatedOnly?: boolean } = {}
): Promise<"written" | "not_newer" | "no_match"> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await admin.from("operators").select(`id, account_activated_at, ${column}`).eq("id", operatorId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return "no_match";
    if (filters.unactivatedOnly && (data as Row).account_activated_at) return "no_match";
    const current = ((data as Row)[column] as string | null) ?? null;
    if (!isAfter(at, current)) return "not_newer";
    const base = admin.from("operators").update({ [column]: at, ...extra }).eq("id", operatorId);
    const cas = current === null ? base.is(column, null) : base.eq(column, current);
    const { data: updated, error: updateError } = await cas.select("id");
    if (updateError) throw new Error(updateError.message);
    if (Array.isArray(updated) ? updated.length > 0 : !!updated) return "written";
  }
  return "not_newer";
}

export function createSetupContactCoordinator(admin: AdminClient, opts: { clock?: () => Date } = {}): SetupContactCoordinator {
  const clock = opts.clock ?? (() => new Date());
  return {
    read: (operatorId) => readState(admin, operatorId),

    async findUnactivatedOperatorId(email) {
      const { data, error } = await admin.from("operators").select("id, account_activated_at").eq("email", email.trim().toLowerCase()).maybeSingle();
      if (error) throw new Error(`operator lookup failed: ${error.message}`);
      if (!data || (data as Row).account_activated_at) return null;
      return (data as Row).id as string;
    },

    async claim(operatorId, kind, now) {
      const state = await readState(admin, operatorId);
      if (!state) return null;
      if (isClaimActive(state.claimedAt, now)) return null;
      // Fold a stale claim into evidence before replacing it: its holder may
      // have reached the provider (or copied a link) before it died.
      if (state.claimedAt) {
        const target = foldTarget(state.claimKind);
        if (target === "milestone") {
          await setIfLater(admin, operatorId, "last_milestone_contact_at", state.claimedAt, { last_milestone_contact_status: "unconfirmed" });
        } else if (target === "setup_contact") {
          await setIfLater(admin, operatorId, "last_setup_contact_at", state.claimedAt, { last_setup_contact_kind: "unconfirmed_setup_contact" });
        } else if (target === "pause") {
          await setIfLater(admin, operatorId, "last_setup_pause_at", state.claimedAt);
        }
      }
      // Stamped with the wall clock (never earlier): a worker's `now` is its
      // pass start, and a claim stamped in the past would look stale to
      // other claimers while its holder is still inside its send window.
      const claimedAt = new Date(Math.max(now.getTime(), clock().getTime())).toISOString();
      const base = admin
        .from("operators")
        .update({ setup_contact_claimed_at: claimedAt, setup_contact_claim_kind: kind })
        .eq("id", operatorId);
      const cas = state.claimedAt ? base.eq("setup_contact_claimed_at", state.claimedAt) : base.is("setup_contact_claimed_at", null);
      const { data, error } = await cas.select("id, setup_contact_claimed_at");
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? (data[0] as Row | undefined) : (data as Row | null);
      if (!row) return null;
      // Token = the value as the database returns it (PostgREST formats
      // timestamptz as "…+00:00"); release compares it in SQL, not as text.
      return (row.setup_contact_claimed_at as string | null) ?? claimedAt;
    },

    async release(operatorId, token) {
      try {
        await admin
          .from("operators")
          .update({ setup_contact_claimed_at: null, setup_contact_claim_kind: null })
          .eq("id", operatorId)
          .eq("setup_contact_claimed_at", token);
      } catch (err) {
        // Self-heals: the claim goes stale after SETUP_CONTACT_CLAIM_TTL_MS.
        console.warn("[setupContactStore] Claim release failed.", { operatorId, error: err instanceof Error ? err.message : String(err) });
      }
    },

    async recordMilestone(operatorId, at, status) {
      return guarded("Milestone", operatorId, () =>
        setIfLater(admin, operatorId, "last_milestone_contact_at", at.toISOString(), { last_milestone_contact_status: status }, { unactivatedOnly: true })
      );
    },

    async recordSetupContact(operatorId, kind, at) {
      return guarded("Setup-contact", operatorId, () =>
        setIfLater(admin, operatorId, "last_setup_contact_at", at.toISOString(), { last_setup_contact_kind: kind }, { unactivatedOnly: true })
      );
    },

    async deferInitialSetup(operatorId, at) {
      try {
        const result = await setIfLater(admin, operatorId, "initial_setup_deferred_at", at.toISOString(), {
          initial_setup_deferred_attempts: 0,
          initial_setup_deferred_last_error: null,
        });
        // "not_newer": an equal or newer request is already queued.
        return result !== "no_match";
      } catch (err) {
        console.warn("[setupContactStore] Initial-setup queue write failed.", { operatorId, error: err instanceof Error ? err.message : String(err) });
        return false;
      }
    },

    async recordPause(operatorId, at) {
      return guarded("Setup-pause", operatorId, () => setIfLater(admin, operatorId, "last_setup_pause_at", at.toISOString(), {}, { unactivatedOnly: true }));
    },
  };
}

async function guarded(label: string, operatorId: string, write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (err) {
    console.warn(`[setupContactStore] ${label} evidence write failed.`, { operatorId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * CONFIRMED delivery evidence (migration 105): stamps
 * operators.last_setup_email_accepted_at with the ATTEMPT START time of a
 * setup email the provider accepted, for whichever UNACTIVATED operator owns
 * `recipientEmail`. Called by sendTransactionalEmail() only after
 * acceptance. Never throws.
 */
export async function recordSetupEmailAcceptedForRecipient(
  admin: AdminClient,
  params: { recipientEmail: string; attemptStartedAt: Date }
): Promise<"written" | "not_newer" | "no_match" | "error"> {
  try {
    const email = params.recipientEmail.trim().toLowerCase();
    const { data, error } = await admin.from("operators").select("id, account_activated_at").eq("email", email).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || (data as Row).account_activated_at) return "no_match";
    return await setIfLater(admin, (data as Row).id as string, "last_setup_email_accepted_at", params.attemptStartedAt.toISOString(), {}, { unactivatedOnly: true });
  } catch (err) {
    console.warn("[setupContactStore] Setup-email acceptance evidence write failed.", { error: err instanceof Error ? err.message : String(err) });
    return "error";
  }
}

/**
 * Records a setup contact for whichever UNACTIVATED operator owns
 * `recipientEmail` (no-op for consumers, activated operators and unknown
 * addresses). Called by sendTransactionalEmail() just before the provider
 * call. Never throws.
 */
export async function recordSetupContactForRecipient(
  admin: AdminClient,
  params: { recipientEmail: string; kind: SetupContactKind; at: Date }
): Promise<"written" | "not_newer" | "no_match" | "error"> {
  try {
    const email = params.recipientEmail.trim().toLowerCase();
    const { data, error } = await admin.from("operators").select("id, account_activated_at").eq("email", email).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || (data as Row).account_activated_at) return "no_match";
    return await setIfLater(admin, (data as Row).id as string, "last_setup_contact_at", params.at.toISOString(), { last_setup_contact_kind: params.kind }, { unactivatedOnly: true });
  } catch (err) {
    console.warn("[setupContactStore] Setup-contact evidence write failed.", { kind: params.kind, error: err instanceof Error ? err.message : String(err) });
    return "error";
  }
}
