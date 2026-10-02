/**
 * Setup-contact / milestone email coordination — pure policy (no I/O).
 *
 * Approved rules (2026-10):
 *   - While an operator has NOT activated their account, keep at least
 *     SETUP_CONTACT_SPACING_MS (48 h) between setup contacts and milestone
 *     emails. Coordination is per operator, across all their venues and
 *     claim/submission origins.
 *   - Milestone after a recent setup contact (email or Copy-link pause) or
 *     another incomplete-setup milestone → defer to the first normal
 *     business-day 3 PM venue-local slot at least 48 h after that contact.
 *   - Automatic reminder after a recent milestone → defer until 48 h after
 *     the milestone; if that point is at or after the setup deadline, skip
 *     the reminder (never send early to bypass spacing).
 *   - Activated operators: no coordination; the standard milestone sends.
 *   - Founder-requested sends/copies and operator-requested emails are never
 *     blocked — they only RECORD evidence that later automated sends respect.
 *
 * Evidence comes only from public.operators columns (migration 104), never
 * from the best-effort email registry or timeline run-start timestamps.
 */

export const SETUP_CONTACT_SPACING_MS = 48 * 60 * 60 * 1000;

/**
 * Lifetime of an automated worker's per-operator claim. Longer than any
 * worker invocation (cron routes run with maxDuration = 60 s) and than
 * Node's default 5-minute fetch headers timeout, so a live send always
 * finishes or dies before its claim can be considered stale.
 */
export const SETUP_CONTACT_CLAIM_TTL_MS = 6 * 60 * 1000;

export type SetupContactKind =
  | "setup_email"
  | "reminder"
  | "founder_resend"
  | "founder_final_resend"
  | "operator_requested"
  | "unconfirmed_setup_contact";

/**
 * Who holds the per-operator contact claim. Founder actions take it too:
 * they are exempt from the 48 h spacing rule, NOT from this claim, so an
 * automatic milestone can never pass its spacing check while a founder
 * contact is being recorded and sent.
 */
export type SetupContactClaimKind = "reminder" | "milestone" | "founder_resend" | "founder_copy" | "initial_setup";

export type MilestoneContactStatus = "accepted" | "unconfirmed";

/** Setup-contact evidence and claim for one operator, as stored on public.operators. */
export type OperatorContactState = {
  operatorId: string;
  activated: boolean;
  lastSetupContactAt: string | null;
  lastSetupContactKind: string | null;
  lastSetupPauseAt: string | null;
  lastMilestoneContactAt: string | null;
  lastMilestoneContactStatus: string | null;
  claimedAt: string | null;
  claimKind: string | null;
};

/**
 * Email types that count as a setup contact when sent to an operator who
 * has not activated. `password_reset` covers operator-requested Forgot
 * Password; the store only records it when the recipient is an unactivated
 * operator (consumers and activated operators are never matched).
 */
const SETUP_CONTACT_EMAIL_TYPES: Record<string, SetupContactKind> = {
  claim_approval: "setup_email",
  operator_activation: "setup_email",
  activation_reminder: "reminder",
  activation_final_setup: "founder_final_resend",
  operator_verification_code: "operator_requested",
  operator_setup_request: "operator_requested",
  password_reset: "operator_requested",
};

/** The setup-contact kind for an outgoing email, or null when it isn't one. */
export function setupContactKindForEmail(emailType: string, trigger?: string | null): SetupContactKind | null {
  const kind = SETUP_CONTACT_EMAIL_TYPES[emailType];
  if (!kind) return null;
  if (kind === "setup_email" && trigger === "founder_resend") return "founder_resend";
  if (kind === "setup_email" && trigger === "recovery_redirect") return "operator_requested";
  return kind;
}

function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Which evidence column a stale claim of this kind folds into. */
export function foldTarget(claimKind: string | null): "milestone" | "setup_contact" | "pause" | null {
  if (claimKind === "milestone") return "milestone";
  if (claimKind === "reminder" || claimKind === "founder_resend" || claimKind === "initial_setup") return "setup_contact";
  if (claimKind === "founder_copy") return "pause";
  return null;
}

export function isClaimActive(claimedAt: string | null | undefined, now: Date): boolean {
  const t = ms(claimedAt);
  return t !== null && now.getTime() - t < SETUP_CONTACT_CLAIM_TTL_MS;
}

/**
 * Evidence with a stale claim folded in conservatively: a claim that went
 * stale means its holder may have reached the provider (or the founder may
 * have copied a link) before dying, so it counts as a possible contact of
 * its kind: milestone → milestone; reminder / founder resend → setup email;
 * founder copy → pause.
 */
export function effectiveEvidence(state: OperatorContactState, now: Date): {
  setupContactAt: number | null;
  setupContactKind: string | null;
  pauseAt: number | null;
  milestoneAt: number | null;
} {
  let setupContactAt = ms(state.lastSetupContactAt);
  let setupContactKind = state.lastSetupContactKind;
  let milestoneAt = ms(state.lastMilestoneContactAt);
  let pauseAt = ms(state.lastSetupPauseAt);
  const claimAt = ms(state.claimedAt);
  if (claimAt !== null && !isClaimActive(state.claimedAt, now)) {
    const kind = foldTarget(state.claimKind);
    if (kind === "milestone" && (milestoneAt === null || claimAt > milestoneAt)) milestoneAt = claimAt;
    if (kind === "setup_contact" && (setupContactAt === null || claimAt > setupContactAt)) {
      setupContactAt = claimAt;
      setupContactKind = "unconfirmed_setup_contact";
    }
    if (kind === "pause" && (pauseAt === null || claimAt > pauseAt)) pauseAt = claimAt;
  }
  return { setupContactAt, setupContactKind, pauseAt, milestoneAt };
}

export type MilestoneDeferReason = "recent_setup_contact" | "recent_setup_pause" | "recent_milestone";

export type MilestoneDecision =
  | { action: "send"; variant: "standard" | "incomplete_setup" }
  /** `earliest` is contact + 48 h; the caller rounds up to a business-day 3 PM slot. */
  | { action: "defer"; earliest: Date; reason: MilestoneDeferReason; contactAt: Date; contactKind: string | null };

/**
 * Template and spacing for a milestone with no previous provider attempt.
 * Activated → standard, uncoordinated. Not activated → incomplete-setup
 * variant, deferred if any setup contact, Copy pause or other
 * incomplete-setup milestone (another venue) is within 48 h. Exactly 48 h
 * later is allowed.
 */
export function decideMilestone(state: OperatorContactState, now: Date): MilestoneDecision {
  if (state.activated) return { action: "send", variant: "standard" };
  const e = effectiveEvidence(state, now);
  const candidates: { at: number; reason: MilestoneDeferReason; kind: string | null }[] = [];
  if (e.setupContactAt !== null) candidates.push({ at: e.setupContactAt, reason: "recent_setup_contact", kind: e.setupContactKind });
  if (e.pauseAt !== null) candidates.push({ at: e.pauseAt, reason: "recent_setup_pause", kind: "copy_setup_link" });
  if (e.milestoneAt !== null) candidates.push({ at: e.milestoneAt, reason: "recent_milestone", kind: "milestone" });
  const latest = candidates.sort((a, b) => b.at - a.at)[0];
  if (latest && now.getTime() < latest.at + SETUP_CONTACT_SPACING_MS) {
    return {
      action: "defer",
      earliest: new Date(latest.at + SETUP_CONTACT_SPACING_MS),
      reason: latest.reason,
      contactAt: new Date(latest.at),
      contactKind: latest.kind,
    };
  }
  return { action: "send", variant: "incomplete_setup" };
}

export type ReminderDecision =
  | { action: "send" }
  | { action: "defer"; until: Date; milestoneAt: Date }
  | { action: "skip"; reason: "spacing_crosses_deadline"; until: Date; milestoneAt: Date };

/**
 * Whether an automatic reminder may send now, given the operator's latest
 * incomplete-setup milestone. Defers to milestone + 48 h; skips when that
 * point is at or after the setup deadline.
 */
export function decideReminder(state: OperatorContactState, deadlineAt: string, now: Date): ReminderDecision {
  const { milestoneAt } = effectiveEvidence(state, now);
  if (milestoneAt === null || now.getTime() >= milestoneAt + SETUP_CONTACT_SPACING_MS) return { action: "send" };
  const until = new Date(milestoneAt + SETUP_CONTACT_SPACING_MS);
  const deadlineMs = ms(deadlineAt);
  if (deadlineMs !== null && until.getTime() >= deadlineMs) {
    return { action: "skip", reason: "spacing_crosses_deadline", until, milestoneAt: new Date(milestoneAt) };
  }
  return { action: "defer", until, milestoneAt: new Date(milestoneAt) };
}
