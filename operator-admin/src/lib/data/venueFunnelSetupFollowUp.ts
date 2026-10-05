/**
 * Venue Funnel — setup follow-up summary for "Setup Stalled / No Response"
 * cards: progress through the three automatic setup reminders, what happens
 * next, and a link to the claim/submission behind the venue's setup.
 *
 * Read-only. Everything is derived from existing authoritative records — the
 * operator's activation lifecycle (operator_activation_lifecycles) and the
 * structured Internal Notes the reminder worker and founder actions write —
 * never from elapsed time or contact evidence:
 *
 *   - A reminder counts as SENT only with its `reminder_sent` note (written
 *     after the provider accepted it). `reminder_stage` is "highest stage
 *     resolved", which a send, a skip (`reminder_skipped`) or a later stage
 *     superseding it can all advance (activationReminderPolicy.ts), so it is
 *     never treated as a sent count.
 *   - An unsuccessful attempt (`reminder_delivery_failed` /
 *     reminder_last_error) is reported as "unsuccessful or unconfirmed" — the
 *     worker records uncertain provider outcomes the same way and persists
 *     nothing that separates them, so it is never called failed or "not
 *     delivered". A retry date appears only when a retry is scheduled.
 *   - A deferral is shown only from a `reminder_deferred` note whose
 *     deferredUntil is the currently scheduled attempt.
 *   - The setup deadline (deadline_at) is kept distinct from a later
 *     recovery-link expiry (Final setup email / Copy link `linkExpiresAt`).
 *
 * Source record: the claim or submission is the ORIGIN of the operator's
 * lifecycle for this venue (origin record's venue_id = the card's venue).
 * Without a lifecycle, a single approved claim/submission tying this
 * operator to this venue is used; anything else is reported as unclear or
 * absent — never guessed from recency.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveActivationState } from "@/lib/activation/activationState";
import { selectCatchUpStage } from "@/lib/activation/activationReminderPolicy";
import { formatDate, formatDateTime } from "@/lib/controlPanelDateTime";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SetupLifecycleFacts = {
  id: string;
  operatorId: string;
  originType: "claim" | "submission";
  originClaimId: string | null;
  originSubmissionId: string | null;
  startedAt: string | null;
  deadlineAt: string | null;
  expiredAt: string | null;
  releasedAt: string | null;
  reminderStage: number;
  nextAttemptAt: string | null;
  attemptCount: number;
  lastError: string | null;
  leaseStartedAt: string | null;
};

/** One structured Internal Note on the source claim/submission, reduced to the fields used here. */
export type SetupNoteFact = {
  eventType: string;
  createdAt: string;
  lifecycleId: string | null;
  stage: number | null;
  deferredUntil: string | null;
  linkExpiresAt: string | null;
};

export type SetupSourceRecord = { kind: "claim" | "submission"; id: string; url: string };

export type SetupFollowUp = {
  /** One-line summary, e.g. "2 of 3 reminders sent". */
  headline: string;
  /** Up to a few short supporting lines (next step, deadline, founder follow-up). */
  lines: string[];
  tone: "info" | "attention" | "muted";
  /** The claim/submission behind this setup, or null when none can be determined. */
  source: SetupSourceRecord | null;
};

export type SourceResolution =
  | { kind: "lifecycle"; lifecycle: SetupLifecycleFacts; source: SetupSourceRecord }
  | { kind: "record"; source: SetupSourceRecord }
  | { kind: "ambiguous" }
  | { kind: "none" };

type ClaimCandidate = { id: string; venueId: string; email: string | null; status: string };
type SubmissionCandidate = { id: string; venueId: string | null; operatorId: string | null; status: string };

/** Note event types this summary reads (nothing else is fetched). */
export const SETUP_FOLLOW_UP_EVENT_TYPES = [
  "reminder_sent",
  "reminder_deferred",
  "reminder_skipped",
  "reminder_delivery_failed",
  "manual_resend",
  "final_setup_email_sent",
  "final_setup_email_unconfirmed",
  "final_setup_link_generated",
] as const;

const claimUrl = (id: string) => `/control-panel/claims/${id}`;
const submissionUrl = (id: string) => `/control-panel/operator-submissions/${id}`;
const sourceOf = (kind: "claim" | "submission", id: string): SetupSourceRecord => ({ kind, id, url: kind === "claim" ? claimUrl(id) : submissionUrl(id) });

const APPROVED_SUBMISSION_STATUSES = new Set(["approved", "confirmed_auto"]);

// ── Source resolution (pure) ───────────────────────────────────────────────────

/**
 * Which claim/submission (and lifecycle) belongs to this venue's current
 * setup. A lifecycle is relevant only when it is the operator's AND its
 * origin record targets this venue. Several relevant lifecycles resolve to
 * the single unreleased one; otherwise the relationship is ambiguous.
 */
export function resolveVenueSetupSource(input: {
  venueId: string;
  operatorId: string;
  operatorEmail: string | null;
  lifecycles: SetupLifecycleFacts[];
  claims: ClaimCandidate[];
  submissions: SubmissionCandidate[];
}): SourceResolution {
  const venueClaims = input.claims.filter((c) => c.venueId === input.venueId);
  const venueSubmissions = input.submissions.filter((s) => s.venueId === input.venueId);
  const claimIds = new Set(venueClaims.map((c) => c.id));
  const submissionIds = new Set(venueSubmissions.map((s) => s.id));

  const relevant = input.lifecycles.filter(
    (l) =>
      l.operatorId === input.operatorId &&
      ((l.originType === "claim" && l.originClaimId !== null && claimIds.has(l.originClaimId)) ||
        (l.originType === "submission" && l.originSubmissionId !== null && submissionIds.has(l.originSubmissionId)))
  );
  const current = relevant.length === 1 ? relevant : relevant.filter((l) => !l.releasedAt);
  if (current.length === 1) {
    const l = current[0];
    return {
      kind: "lifecycle",
      lifecycle: l,
      source: l.originType === "claim" ? sourceOf("claim", l.originClaimId!) : sourceOf("submission", l.originSubmissionId!),
    };
  }
  if (current.length > 1 || relevant.length > 1) return { kind: "ambiguous" };

  // No lifecycle: an approved record tying THIS operator to THIS venue.
  const email = input.operatorEmail?.trim().toLowerCase() ?? null;
  const records: SetupSourceRecord[] = [
    ...venueClaims.filter((c) => c.status === "approved" && email !== null && c.email?.trim().toLowerCase() === email).map((c) => sourceOf("claim", c.id)),
    ...venueSubmissions.filter((s) => APPROVED_SUBMISSION_STATUSES.has(s.status) && s.operatorId === input.operatorId).map((s) => sourceOf("submission", s.id)),
  ];
  if (records.length === 1) return { kind: "record", source: records[0] };
  return records.length > 1 ? { kind: "ambiguous" } : { kind: "none" };
}

// ── Summary (pure) ─────────────────────────────────────────────────────────────

const ms = (t: string | null) => (t ? new Date(t).getTime() : NaN);
const reminderName = (stage: number) => (stage === 3 ? "Final reminder" : `Reminder ${stage}`);

function stageAt(lifecycle: SetupLifecycleFacts, at: string): number {
  const selected = lifecycle.deadlineAt ? selectCatchUpStage(lifecycle.reminderStage, lifecycle.deadlineAt, at) : null;
  return selected ?? Math.min(lifecycle.reminderStage + 1, 3);
}

/** Notes that belong to this lifecycle (by lifecycleId, or unlabelled ones written after it started). */
function notesFor(lifecycle: SetupLifecycleFacts, notes: SetupNoteFact[]): SetupNoteFact[] {
  return notes.filter((n) => n.lifecycleId === lifecycle.id || (n.lifecycleId === null && lifecycle.startedAt !== null && ms(n.createdAt) >= ms(lifecycle.startedAt)));
}

function latest(notes: SetupNoteFact[], types: string[]): SetupNoteFact | null {
  return notes.filter((n) => types.includes(n.eventType)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt))[0] ?? null;
}

function founderFollowUpLine(notes: SetupNoteFact[], now: Date): string | null {
  const n = latest(notes, ["final_setup_email_sent", "final_setup_email_unconfirmed", "final_setup_link_generated", "manual_resend"]);
  if (!n) return null;
  const expiry = n.linkExpiresAt
    ? ms(n.linkExpiresAt) > now.getTime()
      ? ` · link expires ${formatDateTime(n.linkExpiresAt)}`
      : ` · link expired ${formatDate(n.linkExpiresAt)}`
    : "";
  switch (n.eventType) {
    case "final_setup_email_sent":
      return `Final setup email sent ${formatDate(n.createdAt)}${expiry}`;
    case "final_setup_email_unconfirmed":
      return `Final setup email unconfirmed ${formatDate(n.createdAt)}${expiry}`;
    case "final_setup_link_generated":
      return `Setup link copied ${formatDate(n.createdAt)}${expiry}`;
    default:
      return `Setup email resent by founder ${formatDate(n.createdAt)}`;
  }
}

export function summarizeSetupFollowUp(
  input: { resolution: SourceResolution; notes: SetupNoteFact[]; accountActivatedAt: string | null },
  now: Date = new Date()
): SetupFollowUp {
  const { resolution } = input;
  const source = resolution.kind === "lifecycle" || resolution.kind === "record" ? resolution.source : null;

  if (input.accountActivatedAt) return { headline: "Account activated", lines: [], tone: "muted", source };
  if (resolution.kind === "ambiguous") {
    return { headline: "Setup record unclear", lines: ["More than one claim or submission matches — open the venue"], tone: "attention", source: null };
  }
  if (resolution.kind !== "lifecycle") {
    return { headline: "Setup reminders not tracked", lines: ["No activation window recorded for this setup"], tone: "muted", source };
  }

  const l = resolution.lifecycle;
  const notes = notesFor(l, input.notes);
  const sentStages = new Set(notes.filter((n) => n.eventType === "reminder_sent" && n.stage !== null).map((n) => n.stage as number));
  const skippedStages = [...new Set(notes.filter((n) => n.eventType === "reminder_skipped" && n.stage !== null).map((n) => n.stage as number))].sort();
  const progress = `${sentStages.size} of 3 reminders sent`;
  const founder = founderFollowUpLine(notes, now);
  const skippedLines = skippedStages.map((s) => `${reminderName(s)} skipped (milestone spacing)`);

  const state = deriveActivationState(
    { accountActivatedAt: null, activationStartedAt: l.startedAt, activationDeadlineAt: l.deadlineAt, expiredAt: l.expiredAt, releasedAt: l.releasedAt },
    now
  );

  if (state === "released") {
    return { headline: "Setup window released", lines: [progress], tone: "muted", source };
  }
  if (state === "expired" || state === "release_required") {
    return {
      headline: "Setup window expired · Founder follow-up",
      lines: [`${progress} · deadline passed ${formatDate(l.deadlineAt)}`, ...skippedLines, founder ?? "No founder follow-up recorded yet"],
      tone: "attention",
      source,
    };
  }
  if (state === "not_tracked") {
    return { headline: "Setup reminders not tracked", lines: ["Activation window has no deadline recorded"], tone: "muted", source };
  }

  // Live window (awaiting_setup / expiring_soon).
  //
  // Failed attempts: the worker records every unsuccessful send the same way
  // (reminder_delivery_failed / reminder_last_error), including uncertain
  // provider outcomes, and persists nothing that tells them apart — so they
  // are always "unsuccessful or unconfirmed", never "failed". A retry date is
  // shown only when the scheduled attempt IS a retry of that reminder (an
  // attempt count is held, and no recorded deferral owns the schedule).
  const deadlineLine = `Setup deadline ${formatDate(l.deadlineAt)}`;
  const unsuccessful = (stage: number) => `${reminderName(stage)} attempt unsuccessful or unconfirmed`;
  let next: string | null = null;
  let attemptLine: string | null = null;
  let headline = progress;

  const deferral = latest(notes, ["reminder_deferred"]);
  const deferralOwnsSchedule =
    !!l.nextAttemptAt && !!deferral?.deferredUntil && ms(deferral.deferredUntil) === ms(l.nextAttemptAt) && ms(deferral.deferredUntil) > now.getTime();
  const retrying = !!l.nextAttemptAt && l.attemptCount > 0 && !!l.lastError && !deferralOwnsSchedule;

  if (l.leaseStartedAt) {
    next = `${reminderName(stageAt(l, now.toISOString()))} sending now`;
  } else if (retrying) {
    next = `${unsuccessful(stageAt(l, l.nextAttemptAt!))} · retry ${formatDateTime(l.nextAttemptAt)}`;
  } else if (l.nextAttemptAt) {
    const stage = stageAt(l, l.nextAttemptAt);
    next = deferralOwnsSchedule
      ? `${reminderName(deferral!.stage ?? stage)} deferred to ${formatDateTime(deferral!.deferredUntil)} (milestone spacing)`
      : `${reminderName(stage)} due ${formatDate(l.nextAttemptAt)}`;
  } else if (l.reminderStage >= 3) {
    headline = sentStages.size === 3 ? "All 3 reminders sent · Awaiting setup" : `${progress} · none left · Awaiting setup`;
  } else if (l.lastError) {
    next = `${unsuccessful(Math.min(l.reminderStage + 1, 3))} · no retry scheduled`;
  } else {
    next = "Reminders not scheduled yet";
  }

  // An earlier stage whose attempts ran out (recorded failures, never sent,
  // not skipped) while the schedule moved on — or a deferral that now holds
  // a failed stage's schedule. Shown without a retry date: none is scheduled
  // for it.
  if (!retrying && !l.leaseStartedAt) {
    const failed = notes
      .filter((n) => n.eventType === "reminder_delivery_failed" && n.stage !== null && !sentStages.has(n.stage) && !skippedStages.includes(n.stage))
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))[0];
    const upcoming = l.nextAttemptAt ? (deferralOwnsSchedule ? deferral!.stage ?? stageAt(l, l.nextAttemptAt) : stageAt(l, l.nextAttemptAt)) : null;
    if (failed && failed.stage !== null && !(next && next.startsWith(unsuccessful(failed.stage)))) {
      attemptLine = upcoming === failed.stage ? unsuccessful(failed.stage) : `${unsuccessful(failed.stage)} · not retried`;
    }
  }

  return {
    headline,
    lines: [next, attemptLine, ...skippedLines, deadlineLine, founder].filter((x): x is string => !!x),
    tone: state === "expiring_soon" ? "attention" : "info",
    source,
  };
}

// ── Batched loader ─────────────────────────────────────────────────────────────

type MetadataJson = Record<string, unknown> | null;

function toNote(row: { event_type: string; created_at: string; metadata_json: MetadataJson }): SetupNoteFact {
  const m = row.metadata_json ?? {};
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : null);
  const stage = typeof m.stage === "number" ? m.stage : typeof m.stage === "string" && /^[123]$/.test(m.stage) ? Number(m.stage) : null;
  return { eventType: row.event_type, createdAt: row.created_at, lifecycleId: str("lifecycleId"), stage, deferredUntil: str("deferredUntil"), linkExpiresAt: str("linkExpiresAt") };
}

/**
 * Setup follow-up for a set of stalled venues, in a fixed number of batched
 * reads (lifecycles, claims, submissions, then the two note tables) —
 * never one query per card. Returns venueId → summary. Any read failure
 * yields an empty map (cards simply show no summary), never a guess.
 */
export async function loadSetupFollowUps(
  supabase: SupabaseClient,
  venues: { venueId: string; operatorId: string; operatorEmail: string | null; accountActivatedAt: string | null }[],
  now: Date = new Date()
): Promise<Map<string, SetupFollowUp>> {
  const out = new Map<string, SetupFollowUp>();
  if (venues.length === 0) return out;
  const venueIds = [...new Set(venues.map((v) => v.venueId))];
  const operatorIds = [...new Set(venues.map((v) => v.operatorId))];

  const [r_lc, r_claims, r_subs] = await Promise.all([
    supabase
      .from("operator_activation_lifecycles")
      .select("id, operator_id, origin_type, origin_claim_id, origin_submission_id, started_at, deadline_at, expired_at, released_at, reminder_stage, reminder_next_attempt_at, reminder_attempt_count, reminder_last_error, reminder_lease_started_at")
      .in("operator_id", operatorIds),
    supabase.from("venue_claims").select("id, venue_id, email, status").in("venue_id", venueIds),
    supabase.from("operator_submissions").select("id, venue_id, operator_id, status").in("venue_id", venueIds),
  ]);
  if (r_lc.error || r_claims.error || r_subs.error) {
    console.error("[venueFunnelSetupFollowUp] Read failed.", { error: (r_lc.error ?? r_claims.error ?? r_subs.error)?.message });
    return out;
  }

  const lifecycles: SetupLifecycleFacts[] = (r_lc.data ?? []).map((r) => ({
    id: r.id as string,
    operatorId: r.operator_id as string,
    originType: r.origin_type as "claim" | "submission",
    originClaimId: (r.origin_claim_id as string | null) ?? null,
    originSubmissionId: (r.origin_submission_id as string | null) ?? null,
    startedAt: (r.started_at as string | null) ?? null,
    deadlineAt: (r.deadline_at as string | null) ?? null,
    expiredAt: (r.expired_at as string | null) ?? null,
    releasedAt: (r.released_at as string | null) ?? null,
    reminderStage: (r.reminder_stage as number | null) ?? 0,
    nextAttemptAt: (r.reminder_next_attempt_at as string | null) ?? null,
    attemptCount: (r.reminder_attempt_count as number | null) ?? 0,
    lastError: (r.reminder_last_error as string | null) ?? null,
    leaseStartedAt: (r.reminder_lease_started_at as string | null) ?? null,
  }));
  const claims: ClaimCandidate[] = (r_claims.data ?? []).map((c) => ({ id: c.id as string, venueId: c.venue_id as string, email: (c.email as string | null) ?? null, status: c.status as string }));
  const submissions: SubmissionCandidate[] = (r_subs.data ?? []).map((s) => ({
    id: s.id as string,
    venueId: (s.venue_id as string | null) ?? null,
    operatorId: (s.operator_id as string | null) ?? null,
    status: s.status as string,
  }));

  const resolutions = new Map(
    venues.map((v) => [v.venueId, resolveVenueSetupSource({ venueId: v.venueId, operatorId: v.operatorId, operatorEmail: v.operatorEmail, lifecycles, claims, submissions })])
  );
  const sourceClaimIds = new Set<string>();
  const sourceSubmissionIds = new Set<string>();
  for (const r of resolutions.values()) {
    if (r.kind === "lifecycle" || r.kind === "record") (r.source.kind === "claim" ? sourceClaimIds : sourceSubmissionIds).add(r.source.id);
  }

  const types = [...SETUP_FOLLOW_UP_EVENT_TYPES];
  const [r_cn, r_sn] = await Promise.all([
    sourceClaimIds.size > 0
      ? supabase.from("venue_claim_notes").select("claim_id, event_type, created_at, metadata_json").in("claim_id", [...sourceClaimIds]).in("event_type", types)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    sourceSubmissionIds.size > 0
      ? supabase.from("operator_submission_notes").select("submission_id, event_type, created_at, metadata_json").in("submission_id", [...sourceSubmissionIds]).in("event_type", types)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
  ]);
  if (r_cn.error || r_sn.error) {
    console.error("[venueFunnelSetupFollowUp] Note read failed.", { error: (r_cn.error ?? r_sn.error)?.message });
    return out;
  }
  const notesBySource = new Map<string, SetupNoteFact[]>();
  const push = (key: string, row: Record<string, unknown>) => {
    const list = notesBySource.get(key) ?? [];
    list.push(toNote(row as { event_type: string; created_at: string; metadata_json: MetadataJson }));
    notesBySource.set(key, list);
  };
  for (const row of (r_cn.data ?? []) as Record<string, unknown>[]) push(`claim:${row.claim_id}`, row);
  for (const row of (r_sn.data ?? []) as Record<string, unknown>[]) push(`submission:${row.submission_id}`, row);

  for (const v of venues) {
    const resolution = resolutions.get(v.venueId)!;
    const key = resolution.kind === "lifecycle" || resolution.kind === "record" ? `${resolution.source.kind}:${resolution.source.id}` : "";
    out.set(v.venueId, summarizeSetupFollowUp({ resolution, notes: notesBySource.get(key) ?? [], accountActivatedAt: v.accountActivatedAt }, now));
  }
  return out;
}
