import { createAdminClient } from "@/lib/supabase/server";
import {
  deriveActivationState,
  type ActivationLifecycleState,
} from "@/lib/activation/activationState";

/**
 * Server-only, N+1-safe data-access layer for presenting operator-activation
 * lifecycle state on the Founder Control Panel's Claims and Submissions
 * screens (Phase 1B), plus the Phase 1C controlled legacy-activation-resume
 * eligibility resolvers.
 *
 * SCOPE: this module is Control-Panel-internal. It reads
 * `operator_activation_lifecycles`, `operators`, `venue_claims`,
 * `operator_submissions`, and `venues` via the admin (service-role) client —
 * the same access pattern every other Control Panel data-access file in this
 * codebase already uses for internal-only tables. Do NOT import this from a
 * public/consumer/website route; RLS on operator_activation_lifecycles has
 * no permissive policy (service-role only, migration 098), and nothing here
 * weakens that.
 *
 * N+1 SAFETY: migration 098's `operator_activation_lifecycles_origin_claim_uidx`
 * / `..._origin_submission_uidx` guarantee at most ONE lifecycle row ever
 * exists per claim/submission (see that migration's header). Every function
 * here does a small, FIXED number of queries regardless of how many
 * claims/submissions are being presented — batched via `.in(...)` — never
 * one query per row. A list page with 200 claims still issues a handful of
 * queries, not 200.
 */

/**
 * Submission routing-statuses under which a real operator_activation_lifecycles
 * row can legitimately exist for that submission's origin — i.e. provisioning
 * has actually run. There are TWO such paths, both landing on a stored status
 * here: "confirmed_auto" (saveOperatorSubmissionAction provisions immediately
 * at submission time, before any founder review) and "approved" (either
 * founder-approval path — approveAndCreateVenueAction for a brand-new venue,
 * or resolveExistingVenueMatchAction for an existing-venue match — both set
 * status to "approved", never a separate "converted_to_operator" status,
 * which exists only as a legacy display label and is never actually written
 * by current code).
 *
 * Used only to decide whether to render a quiet "Not tracked" Activation
 * card for a submission that has NO lifecycle row — never to decide whether
 * an EXISTING lifecycle is shown: a submission whose status is outside this
 * set but which somehow does have an authoritative lifecycle row (a stale
 * status, a future routing change, any other inconsistency) always shows the
 * card regardless, since real data is never hidden behind a stale label. A
 * rejected/closed/no-match/incomplete-intake submission with no lifecycle
 * correctly shows no card at all.
 */
export const ACTIVATION_RELEVANT_SUBMISSION_STATUSES = new Set(["confirmed_auto", "approved"]);

/**
 * Pure eligibility predicate for whether a Submission detail page should
 * render its Activation card at all — see ACTIVATION_RELEVANT_SUBMISSION_STATUSES
 * above for the full reasoning. Extracted as its own function (rather than
 * left inline in the page component) specifically so it's unit-testable
 * without rendering a Server Component.
 */
export function shouldShowSubmissionActivationCard(status: string, hasLifecycle: boolean): boolean {
  return hasLifecycle || ACTIVATION_RELEVANT_SUBMISSION_STATUSES.has(status);
}

export type ActivationLifecycleSummary = {
  id: string;
  operatorId: string;
  originType: "claim" | "submission";
  startedAt: string;
  deadlineAt: string;
  reminderStage: number;
  expiredAt: string | null;
  releasedAt: string | null;
};

export type ActivationPresentation = {
  state: ActivationLifecycleState;
  lifecycle: ActivationLifecycleSummary | null;
  /**
   * Present whenever an operator has been resolved for this origin — which,
   * as of Phase 1C, includes the "active, no lifecycle" case (a legacy
   * operator who activated before Phase 1A ever existed, or whose origin's
   * lifecycle was simply never started): `lifecycle` is null there, but
   * `operator` is populated so the UI can say WHO and WHEN. Still null for
   * a genuine `not_tracked` origin with no resolvable operator at all.
   */
  operator: {
    id: string;
    accountActivatedAt: string | null;
    name: string | null;
    email: string | null;
  } | null;
};

/** A `not_tracked` presentation with no lifecycle/operator — the safe default
 *  for any claim/submission with no lifecycle row AND no resolvable
 *  already-activated operator (legacy or never-approved). */
export const NOT_TRACKED_PRESENTATION: ActivationPresentation = {
  state: "not_tracked",
  lifecycle: null,
  operator: null,
};

export type SubmissionResendEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * Pure eligibility predicate for whether a Submission's setup email may be
 * resent — the authoritative rule is the LIFECYCLE's own state, never the
 * routing-status label alone. A `confirmed_auto` submission is provisioned
 * (and can have a real, resendable lifecycle) immediately at submission
 * time, before any founder review — the prior "status === 'approved' only"
 * rule silently hid that entire path. Conversely, a stale/incorrect status
 * that merely LOOKS eligible is never enough on its own: without an actual
 * live, unreleased, not-yet-due lifecycle, resend is refused regardless of
 * what the status column says.
 *
 * No I/O — takes an already-fetched ActivationPresentation, so it needs no
 * Supabase client and is fully unit-testable with plain objects.
 */
export function evaluateSubmissionResendEligibility(
  status: string,
  presentation: ActivationPresentation
): SubmissionResendEligibility {
  if (!ACTIVATION_RELEVANT_SUBMISSION_STATUSES.has(status)) {
    return {
      eligible: false,
      reason: "Resend is only available for submissions that were successfully provisioned.",
    };
  }
  if (!presentation.lifecycle) {
    return {
      eligible: false,
      reason: "No activation lifecycle is tracked for this submission — resend is not available.",
    };
  }
  if (presentation.lifecycle.releasedAt) {
    return {
      eligible: false,
      reason:
        "This activation has already been released. Resending a setup email is not " +
        "available — the venue may need to be re-submitted.",
    };
  }
  if (presentation.state === "release_required" || presentation.state === "expired") {
    return {
      eligible: false,
      reason:
        "This activation's deadline has already passed. Extend the deadline before " +
        "resending the setup email, so the operator gets a working window to use it.",
    };
  }
  if (presentation.state === "active") {
    return {
      eligible: false,
      reason: "This operator has already activated their account. No setup email is needed.",
    };
  }
  return { eligible: true };
}

type RawLifecycleRow = {
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
};

type RawOperatorRow = {
  id: string;
  account_activated_at: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

function mapLifecycle(row: RawLifecycleRow): ActivationLifecycleSummary {
  return {
    id: row.id,
    operatorId: row.operator_id,
    originType: row.origin_type,
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
    reminderStage: row.reminder_stage,
    expiredAt: row.expired_at,
    releasedAt: row.released_at,
  };
}

function mapOperatorSummary(row: RawOperatorRow): NonNullable<ActivationPresentation["operator"]> {
  return {
    id: row.id,
    accountActivatedAt: row.account_activated_at,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || null,
    email: row.email,
  };
}

// ── Origin → operator resolution (shared: presentation display AND the
// Phase 1C legacy-resume eligibility checks both need "which operator does
// this claim/submission actually belong to") ────────────────────────────────
//
// AUDITED LINKAGE RULES (verified against live data, not assumed):
//   - Claim: resolve via its venue — venues.claimed_by AND
//     venues.created_by_operator_id must both be set AND equal each other;
//     that shared value is the operator. A claim's own row has no direct
//     operator_id column, so this is the only non-guessed way to derive it —
//     this is NOT "inferring origin from email"; the origin is always the
//     claimId itself, this only resolves which operator that ALREADY-
//     approved origin belongs to.
//   - Submission: operator_submissions.operator_id is a direct, real FK —
//     no join needed. The venue linkage (created_by_operator_id/claimed_by)
//     is still cross-checked for the legacy-resume eligibility path (not for
//     plain presentation) as an extra integrity guard.

type BatchOperatorLinkResult = {
  status: string;
  venueId: string | null;
  /** null when no operator could be resolved for this origin at all
   *  (pending claim, broken linkage, etc.) — always distinct from "resolved
   *  but not yet activated". */
  operatorLink: RawOperatorRow | null;
};

async function batchResolveClaimOperatorLinks(
  claimIds: string[],
  client: ReturnType<typeof createAdminClient>
): Promise<Map<string, BatchOperatorLinkResult>> {
  const result = new Map<string, BatchOperatorLinkResult>();
  if (claimIds.length === 0) return result;

  const { data: claimRows, error: claimError } = await client
    .from("venue_claims")
    .select("id, status, venue_id")
    .in("id", claimIds);

  if (claimError || !claimRows) {
    console.error("[batchResolveClaimOperatorLinks] Claim batch lookup failed:", claimError?.message);
    return result;
  }

  const venueIds = [...new Set(claimRows.map((r) => r.venue_id as string).filter(Boolean))];
  let venueById = new Map<string, { claimed_by: string | null; created_by_operator_id: string | null }>();
  if (venueIds.length > 0) {
    const { data: venueRows, error: venueError } = await client
      .from("venues")
      .select("id, claimed_by, created_by_operator_id")
      .in("id", venueIds);
    if (venueError) {
      console.error("[batchResolveClaimOperatorLinks] Venue batch lookup failed:", venueError.message);
    } else {
      venueById = new Map((venueRows ?? []).map((v) => [v.id as string, v as { claimed_by: string | null; created_by_operator_id: string | null }]));
    }
  }

  const operatorIds = new Set<string>();
  const pending = new Map<string, { status: string; venueId: string | null; operatorId: string | null }>();
  for (const row of claimRows) {
    const claimId = row.id as string;
    const venueId = (row.venue_id as string | null) ?? null;
    const venue = venueId ? venueById.get(venueId) : undefined;
    const operatorId =
      venue?.claimed_by && venue.created_by_operator_id && venue.claimed_by === venue.created_by_operator_id
        ? venue.claimed_by
        : null;
    if (operatorId) operatorIds.add(operatorId);
    pending.set(claimId, { status: row.status as string, venueId, operatorId });
  }

  let operatorById = new Map<string, RawOperatorRow>();
  if (operatorIds.size > 0) {
    const { data: operatorRows, error: operatorError } = await client
      .from("operators")
      .select("id, account_activated_at, first_name, last_name, email")
      .in("id", [...operatorIds]);
    if (operatorError) {
      console.error("[batchResolveClaimOperatorLinks] Operator batch lookup failed:", operatorError.message);
    } else {
      operatorById = new Map((operatorRows ?? []).map((r) => [r.id as string, r as RawOperatorRow]));
    }
  }

  for (const [claimId, p] of pending) {
    result.set(claimId, {
      status: p.status,
      venueId: p.venueId,
      operatorLink: p.operatorId ? operatorById.get(p.operatorId) ?? null : null,
    });
  }
  return result;
}

async function batchResolveSubmissionOperatorLinks(
  submissionIds: string[],
  client: ReturnType<typeof createAdminClient>
): Promise<Map<string, BatchOperatorLinkResult>> {
  const result = new Map<string, BatchOperatorLinkResult>();
  if (submissionIds.length === 0) return result;

  const { data: subRows, error: subError } = await client
    .from("operator_submissions")
    .select("id, status, operator_id, venue_id")
    .in("id", submissionIds);

  if (subError || !subRows) {
    console.error("[batchResolveSubmissionOperatorLinks] Submission batch lookup failed:", subError?.message);
    return result;
  }

  const operatorIds = [...new Set(subRows.map((r) => r.operator_id as string | null).filter((v): v is string => !!v))];
  let operatorById = new Map<string, RawOperatorRow>();
  if (operatorIds.length > 0) {
    const { data: operatorRows, error: operatorError } = await client
      .from("operators")
      .select("id, account_activated_at, first_name, last_name, email")
      .in("id", operatorIds);
    if (operatorError) {
      console.error("[batchResolveSubmissionOperatorLinks] Operator batch lookup failed:", operatorError.message);
    } else {
      operatorById = new Map((operatorRows ?? []).map((r) => [r.id as string, r as RawOperatorRow]));
    }
  }

  for (const row of subRows) {
    const operatorId = row.operator_id as string | null;
    result.set(row.id as string, {
      status: row.status as string,
      venueId: (row.venue_id as string | null) ?? null,
      operatorLink: operatorId ? operatorById.get(operatorId) ?? null : null,
    });
  }
  return result;
}

/**
 * Shared batch core: given already-fetched lifecycle rows keyed by origin id,
 * and a resolved operator-link map for origins with NO lifecycle row,
 * derives a presentation for every id in `originIds`.
 *
 * PHASE 1C FIX: an origin with no lifecycle row is no longer unconditionally
 * `not_tracked`. If its resolved operator has already activated their
 * account (a legacy activation that predates lifecycle tracking, or simply
 * one this origin's lifecycle was never started for), it correctly presents
 * as `active` — matching deriveActivationState()'s own precedence exactly
 * (accountActivatedAt is checked before anything lifecycle-shaped) — with
 * `lifecycle: null` so callers can still distinguish "active with a real
 * tracked window" from "active, nothing was ever tracked".
 */
async function buildPresentations(
  originIds: string[],
  lifecycleByOriginId: Map<string, RawLifecycleRow>,
  noLifecycleLinkByOriginId: Map<string, BatchOperatorLinkResult>,
  client: ReturnType<typeof createAdminClient>,
  now: Date
): Promise<Map<string, ActivationPresentation>> {
  const result = new Map<string, ActivationPresentation>();

  const operatorIds = [...new Set([...lifecycleByOriginId.values()].map((r) => r.operator_id))];

  let operatorById = new Map<string, RawOperatorRow>();
  if (operatorIds.length > 0) {
    const { data: operatorRows, error: operatorError } = await client
      .from("operators")
      .select("id, account_activated_at, first_name, last_name, email")
      .in("id", operatorIds);

    if (operatorError) {
      console.error("[activationPresentation] Operator batch lookup failed:", operatorError.message);
    } else {
      operatorById = new Map((operatorRows ?? []).map((r) => [r.id as string, r as RawOperatorRow]));
    }
  }

  for (const originId of originIds) {
    const raw = lifecycleByOriginId.get(originId);
    if (!raw) {
      const link = noLifecycleLinkByOriginId.get(originId)?.operatorLink ?? null;
      if (link?.account_activated_at) {
        result.set(originId, { state: "active", lifecycle: null, operator: mapOperatorSummary(link) });
      } else {
        result.set(originId, NOT_TRACKED_PRESENTATION);
      }
      continue;
    }

    const operatorRow = operatorById.get(raw.operator_id) ?? null;
    const state = deriveActivationState(
      {
        accountActivatedAt: operatorRow?.account_activated_at ?? null,
        activationStartedAt: raw.started_at,
        activationDeadlineAt: raw.deadline_at,
        expiredAt: raw.expired_at,
        releasedAt: raw.released_at,
      },
      now
    );

    result.set(originId, {
      state,
      lifecycle: mapLifecycle(raw),
      operator: operatorRow ? mapOperatorSummary(operatorRow) : null,
    });
  }

  return result;
}

/**
 * Batched activation presentation for a set of Claim ids. Every id in
 * `claimIds` is present in the returned Map (defaulting to
 * NOT_TRACKED_PRESENTATION when no lifecycle row exists and no already-
 * activated operator can be resolved for that claim).
 */
export async function getActivationPresentationsForClaims(
  claimIds: string[],
  client: ReturnType<typeof createAdminClient> = createAdminClient(),
  now: Date = new Date()
): Promise<Map<string, ActivationPresentation>> {
  if (claimIds.length === 0) return new Map();

  const { data, error } = await client
    .from("operator_activation_lifecycles")
    .select("*")
    .in("origin_claim_id", claimIds);

  if (error) {
    console.error("[getActivationPresentationsForClaims] Lifecycle batch lookup failed:", error.message);
    return new Map(claimIds.map((id) => [id, NOT_TRACKED_PRESENTATION]));
  }

  const lifecycleByOriginId = new Map(
    (data ?? []).map((row) => [(row as RawLifecycleRow).origin_claim_id as string, row as RawLifecycleRow])
  );

  const noLifecycleIds = claimIds.filter((id) => !lifecycleByOriginId.has(id));
  const noLifecycleLinkByOriginId = await batchResolveClaimOperatorLinks(noLifecycleIds, client);

  return buildPresentations(claimIds, lifecycleByOriginId, noLifecycleLinkByOriginId, client, now);
}

/**
 * Batched activation presentation for a set of Submission ids — same
 * contract as getActivationPresentationsForClaims(), keyed on
 * origin_submission_id instead.
 */
export async function getActivationPresentationsForSubmissions(
  submissionIds: string[],
  client: ReturnType<typeof createAdminClient> = createAdminClient(),
  now: Date = new Date()
): Promise<Map<string, ActivationPresentation>> {
  if (submissionIds.length === 0) return new Map();

  const { data, error } = await client
    .from("operator_activation_lifecycles")
    .select("*")
    .in("origin_submission_id", submissionIds);

  if (error) {
    console.error("[getActivationPresentationsForSubmissions] Lifecycle batch lookup failed:", error.message);
    return new Map(submissionIds.map((id) => [id, NOT_TRACKED_PRESENTATION]));
  }

  const lifecycleByOriginId = new Map(
    (data ?? []).map((row) => [(row as RawLifecycleRow).origin_submission_id as string, row as RawLifecycleRow])
  );

  const noLifecycleIds = submissionIds.filter((id) => !lifecycleByOriginId.has(id));
  const noLifecycleLinkByOriginId = await batchResolveSubmissionOperatorLinks(noLifecycleIds, client);

  return buildPresentations(submissionIds, lifecycleByOriginId, noLifecycleLinkByOriginId, client, now);
}

/**
 * Single-Claim convenience wrapper for detail pages — a thin call to the
 * batch function with a one-element array, so detail and list pages share
 * one code path. Never creates a lifecycle merely by being called.
 */
export async function getActivationPresentationForClaim(
  claimId: string,
  client: ReturnType<typeof createAdminClient> = createAdminClient(),
  now: Date = new Date()
): Promise<ActivationPresentation> {
  const map = await getActivationPresentationsForClaims([claimId], client, now);
  return map.get(claimId) ?? NOT_TRACKED_PRESENTATION;
}

/**
 * Single-Submission convenience wrapper for detail pages — see
 * getActivationPresentationForClaim() above.
 */
export async function getActivationPresentationForSubmission(
  submissionId: string,
  client: ReturnType<typeof createAdminClient> = createAdminClient(),
  now: Date = new Date()
): Promise<ActivationPresentation> {
  const map = await getActivationPresentationsForSubmissions([submissionId], client, now);
  return map.get(submissionId) ?? NOT_TRACKED_PRESENTATION;
}

// ── Phase 1C: controlled legacy activation-resume eligibility ──────────────
//
// A founder-triggered, one-record-at-a-time action to opt a single legacy
// unactivated operator into activation tracking from their Claim or
// Submission detail page. NOT a bulk backfill — see
// legacyActivationResumeImpl.ts for the action itself. The functions below
// are the read-only eligibility layer: a PURE predicate (no I/O, cheap to
// test) plus an I/O resolver that gathers the raw facts the predicate needs.
// Both the detail page (deciding whether to show the button) and the action
// itself (which must independently re-verify at submit time, never trusting
// the page) call the SAME resolver — every call re-reads the database fresh;
// nothing is cached or passed from the page into the action.

export type LegacyActivationEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

export type LegacyActivationOriginCheck = {
  originStatus: string;
  /** Resolved via the audited linkage rules — null when no clean,
   *  unambiguous operator can be derived for this origin at all. */
  operatorId: string | null;
  operatorAccountActivatedAt: string | null;
  /** Does operator_activation_lifecycles already have ANY row (live,
   *  expired, or released) for this EXACT origin? Migration 098's
   *  per-origin unique index makes a second row for the same origin
   *  permanently impossible — this must be checked explicitly rather than
   *  left to claimOrReuseActivationLifecycle()'s 23505 handling, which only
   *  re-reads by operator-liveness and would misreport this specific
   *  conflict as an unexpected failure. */
  originHasAnyLifecycle: boolean;
  /** Does this operator already have a LIVE lifecycle under a DIFFERENT
   *  origin? (Expired/released lifecycles elsewhere never block a new
   *  origin — only a live one does, matching the one-live-lifecycle-per-
   *  operator invariant.) */
  operatorHasLiveLifecycleElsewhere: boolean;
};

function evaluateLegacyActivationEligibilityCore(check: LegacyActivationOriginCheck): LegacyActivationEligibility {
  if (!check.operatorId) {
    return {
      eligible: false,
      reason:
        "Could not resolve a single, unambiguous operator for this record — the venue " +
        "ownership linkage isn't clean enough for controlled activation resume.",
    };
  }
  if (check.operatorAccountActivatedAt) {
    return { eligible: false, reason: "This operator has already activated their account." };
  }
  if (check.originHasAnyLifecycle) {
    return {
      eligible: false,
      reason: "This record has already had activation tracking started previously — it cannot be started again.",
    };
  }
  if (check.operatorHasLiveLifecycleElsewhere) {
    return {
      eligible: false,
      reason: "This operator already has an active tracking window under a different Claim or Submission.",
    };
  }
  return { eligible: true };
}

/** Claims — accepted origin status: exactly "approved" (the only status
 *  under which a claim has ever provisioned an operator — see
 *  reviewClaimAction's approve branch). */
export function evaluateLegacyClaimActivationEligibility(
  check: LegacyActivationOriginCheck
): LegacyActivationEligibility {
  if (check.originStatus !== "approved") {
    return { eligible: false, reason: "Only approved claims are eligible for controlled activation resume." };
  }
  return evaluateLegacyActivationEligibilityCore(check);
}

/** Submissions — accepted origin statuses: "confirmed_auto" or "approved"
 *  (ACTIVATION_RELEVANT_SUBMISSION_STATUSES — the same set Phase 1B's
 *  resend eligibility already established as "provisioning is expected to
 *  have run"). */
export function evaluateLegacySubmissionActivationEligibility(
  check: LegacyActivationOriginCheck
): LegacyActivationEligibility {
  if (!ACTIVATION_RELEVANT_SUBMISSION_STATUSES.has(check.originStatus)) {
    return {
      eligible: false,
      reason: "Only confirmed_auto or founder-approved submissions are eligible for controlled activation resume.",
    };
  }
  return evaluateLegacyActivationEligibilityCore(check);
}

export type ResolvedLegacyActivationOrigin = {
  found: boolean;
  originStatus: string | null;
  operatorId: string | null;
  operatorEmail: string | null;
  operatorFirstName: string | null;
  operatorAccountActivatedAt: string | null;
  originHasAnyLifecycle: boolean;
  operatorHasLiveLifecycleElsewhere: boolean;
};

const NOT_FOUND_ORIGIN: ResolvedLegacyActivationOrigin = {
  found: false,
  originStatus: null,
  operatorId: null,
  operatorEmail: null,
  operatorFirstName: null,
  operatorAccountActivatedAt: null,
  originHasAnyLifecycle: false,
  operatorHasLiveLifecycleElsewhere: false,
};

async function operatorHasLiveLifecycleElsewhere(
  operatorId: string,
  excludeLifecycleColumn: "origin_claim_id" | "origin_submission_id",
  excludeOriginId: string,
  client: ReturnType<typeof createAdminClient>
): Promise<boolean> {
  const { data, error } = await client
    .from("operator_activation_lifecycles")
    .select("id, origin_claim_id, origin_submission_id")
    .eq("operator_id", operatorId)
    .is("expired_at", null)
    .is("released_at", null)
    .maybeSingle();

  if (error) {
    console.error("[operatorHasLiveLifecycleElsewhere] Lookup failed:", error.message);
    // Fail safe: an unreadable state must never be treated as "no conflict".
    return true;
  }
  if (!data) return false;
  const sameOrigin = (data[excludeLifecycleColumn] as string | null) === excludeOriginId;
  return !sameOrigin;
}

/**
 * Resolves every raw fact needed to decide (and, if eligible, to actually
 * perform) a controlled legacy activation resume for a single Claim —
 * always a fresh read, never cached. `found: false` means the claim id
 * doesn't exist.
 */
export async function resolveLegacyClaimActivationOrigin(
  claimId: string,
  client: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<ResolvedLegacyActivationOrigin> {
  const { data: claimRow, error: claimError } = await client
    .from("venue_claims")
    .select("id, status, venue_id")
    .eq("id", claimId)
    .maybeSingle();

  if (claimError || !claimRow) {
    if (claimError) console.error("[resolveLegacyClaimActivationOrigin] Claim fetch failed:", claimError.message);
    return NOT_FOUND_ORIGIN;
  }

  const venueId = claimRow.venue_id as string | null;
  let operatorId: string | null = null;
  if (venueId) {
    const { data: venueRow, error: venueError } = await client
      .from("venues")
      .select("claimed_by, created_by_operator_id")
      .eq("id", venueId)
      .maybeSingle();
    if (venueError) {
      console.error("[resolveLegacyClaimActivationOrigin] Venue fetch failed:", venueError.message);
    } else if (venueRow?.claimed_by && venueRow.created_by_operator_id && venueRow.claimed_by === venueRow.created_by_operator_id) {
      operatorId = venueRow.claimed_by as string;
    }
  }

  return resolveCommonLegacyOriginFacts({
    originStatus: claimRow.status as string,
    operatorId,
    originLifecycleColumn: "origin_claim_id",
    originId: claimId,
    client,
  });
}

/**
 * Resolves every raw fact needed to decide (and, if eligible, to actually
 * perform) a controlled legacy activation resume for a single Submission —
 * always a fresh read, never cached. `found: false` means the submission id
 * doesn't exist.
 */
export async function resolveLegacySubmissionActivationOrigin(
  submissionId: string,
  client: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<ResolvedLegacyActivationOrigin> {
  const { data: subRow, error: subError } = await client
    .from("operator_submissions")
    .select("id, status, operator_id, venue_id")
    .eq("id", submissionId)
    .maybeSingle();

  if (subError || !subRow) {
    if (subError) console.error("[resolveLegacySubmissionActivationOrigin] Submission fetch failed:", subError.message);
    return NOT_FOUND_ORIGIN;
  }

  let operatorId = (subRow.operator_id as string | null) ?? null;
  const venueId = subRow.venue_id as string | null;

  // Extra integrity guard beyond the direct FK: cross-check the linked
  // venue actually agrees this is its operator. A submission whose venue
  // linkage has drifted (should never happen, but never trusted blindly for
  // an action this deliberate) is treated as unresolved, not guessed at.
  if (operatorId && venueId) {
    const { data: venueRow, error: venueError } = await client
      .from("venues")
      .select("claimed_by, created_by_operator_id")
      .eq("id", venueId)
      .maybeSingle();
    if (venueError) {
      console.error("[resolveLegacySubmissionActivationOrigin] Venue fetch failed:", venueError.message);
      operatorId = null;
    } else if (!(venueRow?.claimed_by === operatorId && venueRow?.created_by_operator_id === operatorId)) {
      operatorId = null;
    }
  } else if (!operatorId) {
    operatorId = null;
  }

  return resolveCommonLegacyOriginFacts({
    originStatus: subRow.status as string,
    operatorId,
    originLifecycleColumn: "origin_submission_id",
    originId: submissionId,
    client,
  });
}

async function resolveCommonLegacyOriginFacts({
  originStatus,
  operatorId,
  originLifecycleColumn,
  originId,
  client,
}: {
  originStatus: string;
  operatorId: string | null;
  originLifecycleColumn: "origin_claim_id" | "origin_submission_id";
  originId: string;
  client: ReturnType<typeof createAdminClient>;
}): Promise<ResolvedLegacyActivationOrigin> {
  const { data: existingOriginLifecycle, error: originLifecycleError } = await client
    .from("operator_activation_lifecycles")
    .select("id")
    .eq(originLifecycleColumn, originId)
    .maybeSingle();

  if (originLifecycleError) {
    console.error("[resolveCommonLegacyOriginFacts] Origin-lifecycle lookup failed:", originLifecycleError.message);
  }
  const originHasAnyLifecycle = !!existingOriginLifecycle;

  let operatorEmail: string | null = null;
  let operatorFirstName: string | null = null;
  let operatorAccountActivatedAt: string | null = null;
  let liveElsewhere = false;

  if (operatorId) {
    const { data: operatorRow, error: operatorError } = await client
      .from("operators")
      .select("email, first_name, account_activated_at")
      .eq("id", operatorId)
      .maybeSingle();
    if (operatorError) {
      console.error("[resolveCommonLegacyOriginFacts] Operator fetch failed:", operatorError.message);
    } else if (operatorRow) {
      operatorEmail = (operatorRow.email as string | null) ?? null;
      operatorFirstName = (operatorRow.first_name as string | null) ?? null;
      operatorAccountActivatedAt = (operatorRow.account_activated_at as string | null) ?? null;
    }

    if (!originHasAnyLifecycle) {
      liveElsewhere = await operatorHasLiveLifecycleElsewhere(operatorId, originLifecycleColumn, originId, client);
    }
  }

  return {
    found: true,
    originStatus,
    operatorId,
    operatorEmail,
    operatorFirstName,
    operatorAccountActivatedAt,
    originHasAnyLifecycle,
    operatorHasLiveLifecycleElsewhere: liveElsewhere,
  };
}

/** Page-level convenience: resolve + evaluate in one call, discarding the
 *  extra fields the action itself needs — used only to decide whether to
 *  render the "Start activation tracking" button. Never authoritative on
 *  its own; the action re-resolves and re-evaluates independently. */
export async function getLegacyClaimActivationEligibility(
  claimId: string,
  client: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<LegacyActivationEligibility> {
  const origin = await resolveLegacyClaimActivationOrigin(claimId, client);
  if (!origin.found) return { eligible: false, reason: "Claim not found." };
  return evaluateLegacyClaimActivationEligibility({
    originStatus: origin.originStatus as string,
    operatorId: origin.operatorId,
    operatorAccountActivatedAt: origin.operatorAccountActivatedAt,
    originHasAnyLifecycle: origin.originHasAnyLifecycle,
    operatorHasLiveLifecycleElsewhere: origin.operatorHasLiveLifecycleElsewhere,
  });
}

/** Page-level convenience — see getLegacyClaimActivationEligibility() above. */
export async function getLegacySubmissionActivationEligibility(
  submissionId: string,
  client: ReturnType<typeof createAdminClient> = createAdminClient()
): Promise<LegacyActivationEligibility> {
  const origin = await resolveLegacySubmissionActivationOrigin(submissionId, client);
  if (!origin.found) return { eligible: false, reason: "Submission not found." };
  return evaluateLegacySubmissionActivationEligibility({
    originStatus: origin.originStatus as string,
    operatorId: origin.operatorId,
    operatorAccountActivatedAt: origin.operatorAccountActivatedAt,
    originHasAnyLifecycle: origin.originHasAnyLifecycle,
    operatorHasLiveLifecycleElsewhere: origin.operatorHasLiveLifecycleElsewhere,
  });
}
