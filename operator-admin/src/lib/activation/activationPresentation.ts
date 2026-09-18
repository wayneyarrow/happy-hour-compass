import { createAdminClient } from "@/lib/supabase/server";
import {
  deriveActivationState,
  type ActivationLifecycleState,
} from "@/lib/activation/activationState";

/**
 * Server-only, N+1-safe data-access layer for presenting operator-activation
 * lifecycle state on the Founder Control Panel's Claims and Submissions
 * screens (Phase 1B).
 *
 * SCOPE: this module is Control-Panel-internal. It reads
 * `operator_activation_lifecycles` and `operators.account_activated_at` via
 * the admin (service-role) client — the same access pattern every other
 * Control Panel data-access file in this codebase already uses for
 * internal-only tables. Do NOT import this from a public/consumer/website
 * route; RLS on operator_activation_lifecycles has no permissive policy
 * (service-role only, migration 098), and nothing here weakens that.
 *
 * N+1 SAFETY: migration 098's `operator_activation_lifecycles_origin_claim_uidx`
 * / `..._origin_submission_uidx` guarantee at most ONE lifecycle row ever
 * exists per claim/submission (see that migration's header). Combined with
 * that, every function here does exactly two queries regardless of how many
 * claims/submissions are being presented: one batched lookup of lifecycle
 * rows via `.in("origin_claim_id"/"origin_submission_id", ids)`, and one
 * batched lookup of the distinct operators those rows reference. A list page
 * with 200 claims still issues 2 queries, not 200.
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
  /** Present only when a lifecycle row exists — the operator it belongs to. */
  operator: {
    id: string;
    accountActivatedAt: string | null;
    name: string | null;
    email: string | null;
  } | null;
};

/** A `not_tracked` presentation with no lifecycle/operator — the safe default
 *  for any claim/submission with no lifecycle row (legacy or never-approved). */
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

/**
 * Shared batch core: given already-fetched lifecycle rows keyed by origin id,
 * fetches the (deduplicated) operators they reference in one query, then
 * derives a presentation for every id in `originIds` — including ids with no
 * lifecycle row at all, which correctly resolve to NOT_TRACKED_PRESENTATION.
 */
async function buildPresentations(
  originIds: string[],
  lifecycleByOriginId: Map<string, RawLifecycleRow>,
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
      result.set(originId, NOT_TRACKED_PRESENTATION);
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
      operator: operatorRow
        ? {
            id: operatorRow.id,
            accountActivatedAt: operatorRow.account_activated_at,
            name: [operatorRow.first_name, operatorRow.last_name].filter(Boolean).join(" ") || null,
            email: operatorRow.email,
          }
        : null,
    });
  }

  return result;
}

/**
 * Batched activation presentation for a set of Claim ids — exactly 2 queries
 * regardless of how many ids are passed. Every id in `claimIds` is present
 * in the returned Map (defaulting to NOT_TRACKED_PRESENTATION when no
 * lifecycle row exists for that claim).
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

  return buildPresentations(claimIds, lifecycleByOriginId, client, now);
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

  return buildPresentations(submissionIds, lifecycleByOriginId, client, now);
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
