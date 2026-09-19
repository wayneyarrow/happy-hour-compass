"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { extendActivationDeadlineAction, type ExtendDeadlineState } from "@/lib/activation/activationLifecycleActions";
import {
  resumeLegacyClaimActivationAction,
  resumeLegacySubmissionActivationAction,
  type LegacyActivationResumeState,
} from "@/lib/activation/legacyActivationResumeActions";
import { releaseActivationLifecycleAction, type ReleaseActivationState } from "@/lib/activation/activationReleaseActions";
import { formatDeadlineCountdown } from "@/lib/activation/activationState";
import { getActivationEventLabel } from "@/lib/activation/activationEvents";
import { formatDateTime } from "@/lib/controlPanelDateTime";
import ActivationBadge from "@/components/ActivationBadge";
import type { ActivationPresentation, LegacyActivationEligibility } from "@/lib/activation/activationPresentation";

const EXTEND_INITIAL_STATE: ExtendDeadlineState = {};
const LEGACY_INITIAL_STATE: LegacyActivationResumeState = {};
const RELEASE_INITIAL_STATE: ReleaseActivationState = {};

export type LastActivationEvent = { eventType: string | null; createdAt: string } | null;

/** Only relevant when presentation.state === "not_tracked" — the page has
 *  already resolved (fresh, server-side) whether a controlled legacy resume
 *  is possible here, and the recipient email to show in the confirmation.
 *  This is a DISPLAY convenience only — the action itself always
 *  independently re-resolves and re-validates everything at submit time,
 *  never trusting this prop. */
export type LegacyResumeCandidate = {
  origin: { type: "claim"; claimId: string } | { type: "submission"; submissionId: string };
  eligibility: LegacyActivationEligibility;
  recipientEmail: string | null;
};

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="text-gray-400 w-28 shrink-0">{label}</dt>
      <dd className="text-gray-800 min-w-0 break-words">{children}</dd>
    </div>
  );
}

type LifecycleSummaryForReminders = NonNullable<ActivationPresentation["lifecycle"]>;

/**
 * Compact reminder-progress presentation (Phase 2A-4) — replaces the prior
 * hardcoded "No automated reminders sent" line. Reads only the migration-099
 * observability fields already forwarded onto ActivationLifecycleSummary
 * (activationPresentation.ts); never a setup link, token, or raw internal
 * error beyond the already-sanitized reminder_last_error string the worker
 * itself truncates before ever writing it.
 */
function ReminderStatus({
  lifecycle,
  remindersEnabled,
}: {
  lifecycle: LifecycleSummaryForReminders;
  remindersEnabled: boolean;
}) {
  if (!remindersEnabled) {
    return <span className="text-gray-400 italic">Automated reminders are currently disabled</span>;
  }

  const stageText = `Stage ${lifecycle.reminderStage} of 3 resolved`;

  if (lifecycle.reminderLeaseStartedAt) {
    return (
      <span>
        {stageText} · <span className="text-amber-600 font-medium">Reminder currently processing</span>
      </span>
    );
  }
  if (lifecycle.reminderNextAttemptAt) {
    return (
      <span>
        {stageText} · Next attempt {formatDateTime(lifecycle.reminderNextAttemptAt)}
      </span>
    );
  }
  if (lifecycle.reminderStage >= 3) {
    return <span>{stageText} · No further automatic reminders scheduled</span>;
  }
  if (lifecycle.reminderLastError) {
    return <span className="text-red-600">{stageText} · Last attempt failed — no further reminders scheduled</span>;
  }
  return <span>{stageText}</span>;
}

export default function ActivationCard({
  presentation,
  lastEvent,
  legacyResume,
  remindersEnabled,
}: {
  presentation: ActivationPresentation;
  lastEvent: LastActivationEvent;
  legacyResume?: LegacyResumeCandidate;
  /**
   * Whether the operator-activation reminder worker's kill switch
   * (OPERATOR_ACTIVATION_REMINDERS_ENABLED) is currently "true" — resolved
   * server-side via isOperatorActivationReminderProcessingEnabled() and
   * passed down as a plain boolean. Never read an env var from a Client
   * Component; this prop is the only channel.
   */
  remindersEnabled: boolean;
}) {
  const router = useRouter();
  const { state: activationState, lifecycle, operator } = presentation;

  // ── Extend deadline (existing, Phase 1B) ────────────────────────────────────
  const extendBoundAction = lifecycle
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (extendActivationDeadlineAction as any).bind(null, lifecycle.id)
    : async () => EXTEND_INITIAL_STATE;
  const [extendState, extendFormAction, extendPending] = useActionState<ExtendDeadlineState, FormData>(
    extendBoundAction,
    EXTEND_INITIAL_STATE
  );

  // ── Controlled legacy activation resume (Phase 1C) — hooks must always be
  // called, so a no-op fallback is used whenever there's no candidate. ───────
  const legacyBoundAction = legacyResume
    ? legacyResume.origin.type === "claim"
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (resumeLegacyClaimActivationAction as any).bind(null, legacyResume.origin.claimId)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (resumeLegacySubmissionActivationAction as any).bind(null, legacyResume.origin.submissionId)
    : async () => LEGACY_INITIAL_STATE;
  const [legacyState, legacyFormAction, legacyPending] = useActionState<LegacyActivationResumeState, FormData>(
    legacyBoundAction,
    LEGACY_INITIAL_STATE
  );

  const didRefreshExtend = useRef(false);
  useEffect(() => {
    if (extendState.success && !didRefreshExtend.current) {
      didRefreshExtend.current = true;
      router.refresh();
    }
    if (!extendState.success) didRefreshExtend.current = false;
  }, [extendState.success, router]);

  const didRefreshLegacy = useRef(false);
  useEffect(() => {
    if (legacyState.success && !didRefreshLegacy.current) {
      didRefreshLegacy.current = true;
      router.refresh();
    }
    if (!legacyState.success) didRefreshLegacy.current = false;
  }, [legacyState.success, router]);

  // ── Manual Release (Phase 2A-4) ─────────────────────────────────────────────
  const releaseBoundAction = lifecycle
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (releaseActivationLifecycleAction as any).bind(null, lifecycle.id)
    : async () => RELEASE_INITIAL_STATE;
  const [releaseState, releaseFormAction, releasePending] = useActionState<ReleaseActivationState, FormData>(
    releaseBoundAction,
    RELEASE_INITIAL_STATE
  );

  const didRefreshRelease = useRef(false);
  useEffect(() => {
    if (releaseState.success && !didRefreshRelease.current) {
      didRefreshRelease.current = true;
      router.refresh();
    }
    if (!releaseState.success) didRefreshRelease.current = false;
  }, [releaseState.success, router]);

  const canExtend = !!lifecycle && !lifecycle.releasedAt && activationState !== "active";

  // Server-side action eligibility remains authoritative regardless of this
  // — this only controls whether the button renders at all.
  const canRelease =
    !!lifecycle &&
    !lifecycle.releasedAt &&
    (activationState === "release_required" || activationState === "expired") &&
    !lifecycle.reminderLeaseStartedAt;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Activation</h3>
        <ActivationBadge state={activationState} />
      </div>

      {activationState === "active" ? (
        // Activated operator — never resend/legacy-resume/extend/countdown,
        // regardless of whether a lifecycle happens to still be attached
        // (Phase 1C QA correction: an activated operator with a completed
        // lifecycle has nothing left to track any more than one who
        // activated before lifecycle tracking ever existed). The
        // "before lifecycle tracking" wording is only accurate when there
        // truly was never a lifecycle for this origin.
        <div className="space-y-2.5">
          <p className="text-sm text-gray-600">
            {lifecycle ? "Active — account activated" : "Active — account activated before lifecycle tracking"}
          </p>
          <dl className="space-y-2.5">
            <MetaRow label="Operator">{operator?.name || operator?.email || "—"}</MetaRow>
            {operator?.email && (
              <MetaRow label="Email">
                <a href={`mailto:${operator.email}`} className="text-amber-700 hover:underline">
                  {operator.email}
                </a>
              </MetaRow>
            )}
            {operator?.accountActivatedAt && (
              <MetaRow label="Activated">
                <span className="text-green-700 font-medium">{formatDateTime(operator.accountActivatedAt)}</span>
              </MetaRow>
            )}
          </dl>
        </div>
      ) : !lifecycle ? (
        // Genuine not_tracked — either a legacy record predating activation
        // tracking, or one where tracking was simply never begun. Never
        // implies the system is broken.
        <div className="space-y-3">
          <p className="text-sm text-gray-500 italic">
            Legacy account — activation tracking was not started
          </p>
          <p className="text-xs text-gray-400">
            This record predates activation tracking, or tracking was never begun for it. This is not an error.
          </p>

          {legacyState.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {legacyState.error}
            </div>
          )}
          {legacyState.success && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              {legacyState.successAction}
            </div>
          )}

          {legacyResume?.eligibility.eligible && (
            <form
              action={legacyFormAction}
              onSubmit={(e) => {
                const recipient = legacyResume.recipientEmail ?? "this operator";
                const confirmed = window.confirm(
                  `Start activation tracking for ${recipient}?\n\n` +
                    "This will:\n" +
                    "• Begin a fresh 14-day activation deadline\n" +
                    "• Send a setup email immediately\n" +
                    "• Add an Internal Note\n\n" +
                    "This does not change this claim/submission's approval status or venue verification."
                );
                if (!confirmed) e.preventDefault();
              }}
            >
              <button
                type="submit"
                disabled={legacyPending}
                className="w-full px-4 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {legacyPending ? "Starting…" : "Start activation tracking & resend setup email"}
              </button>
            </form>
          )}
        </div>
      ) : (
        <>
          <dl className="space-y-2.5 mb-4">
            <MetaRow label="Operator">{operator?.name || operator?.email || "—"}</MetaRow>
            {operator?.email && (
              <MetaRow label="Email">
                <a href={`mailto:${operator.email}`} className="text-amber-700 hover:underline">
                  {operator.email}
                </a>
              </MetaRow>
            )}
            <MetaRow label="Origin">
              {lifecycle.originType === "claim" ? "Venue claim" : "Add Your Venue submission"}
            </MetaRow>
            <MetaRow label="Started">{formatDateTime(lifecycle.startedAt)}</MetaRow>
            <MetaRow label="Deadline">{formatDateTime(lifecycle.deadlineAt)}</MetaRow>
            <MetaRow label="Remaining">{formatDeadlineCountdown(lifecycle.deadlineAt) ?? "—"}</MetaRow>
            <MetaRow label="Reminders">
              <ReminderStatus lifecycle={lifecycle} remindersEnabled={remindersEnabled} />
            </MetaRow>
            {remindersEnabled && lifecycle.reminderAttemptCount > 0 && (
              <MetaRow label="Last attempt">
                <span className="text-red-600">
                  {lifecycle.reminderAttemptCount}/3 · {lifecycle.reminderLastAttemptedAt ? formatDateTime(lifecycle.reminderLastAttemptedAt) : "—"}
                  {lifecycle.reminderLastError ? ` — ${lifecycle.reminderLastError}` : ""}
                </span>
              </MetaRow>
            )}
            {operator?.accountActivatedAt && (
              <MetaRow label="Activated">
                <span className="text-green-700 font-medium">{formatDateTime(operator.accountActivatedAt)}</span>
              </MetaRow>
            )}
            {lifecycle.expiredAt && (
              <>
                <MetaRow label="Expired">{formatDateTime(lifecycle.expiredAt)}</MetaRow>
                <MetaRow label="Notified">
                  <span className="text-xs text-gray-600">
                    {lifecycle.expirySlackNotifiedAt ? "Slack ✓" : "Slack pending"} ·{" "}
                    {lifecycle.expiryFounderEmailSentAt ? "Email ✓" : "Email pending"}
                  </span>
                </MetaRow>
              </>
            )}
            {lifecycle.releasedAt && (
              <MetaRow label="Released">
                <span className="text-slate-700 font-medium">{formatDateTime(lifecycle.releasedAt)}</span>
              </MetaRow>
            )}
            {lastEvent?.eventType && (
              <MetaRow label="Last event">
                {getActivationEventLabel(lastEvent.eventType)} · {formatDateTime(lastEvent.createdAt)}
              </MetaRow>
            )}
          </dl>

          {extendState.error && (
            <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {extendState.error}
            </div>
          )}
          {extendState.success && (
            <div className="mb-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              {extendState.successAction}
            </div>
          )}

          {canExtend && (
            <form
              action={extendFormAction}
              onSubmit={(e) => {
                if (!window.confirm("Extend this activation deadline by 7 days?")) {
                  e.preventDefault();
                }
              }}
              className={canRelease ? "mb-3" : undefined}
            >
              <button
                type="submit"
                disabled={extendPending}
                className="w-full px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {extendPending ? "Extending…" : "Extend deadline by 7 days"}
              </button>
            </form>
          )}

          {releaseState.error && (
            <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {releaseState.error}
            </div>
          )}
          {releaseState.success && (
            <div className="mb-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              {releaseState.successAction}
            </div>
          )}

          {canRelease && (
            <form
              action={releaseFormAction}
              onSubmit={(e) => {
                const confirmed = window.confirm(
                  "Release this venue?\n\n" +
                    "This will:\n" +
                    "• Close this activation lifecycle\n" +
                    "• Clear this venue's ownership so it can be re-claimed\n" +
                    "• Add an Internal Note\n\n" +
                    "This does not affect any other venue this operator may own, and does not send any " +
                    "email or Slack notification."
                );
                if (!confirmed) e.preventDefault();
              }}
            >
              <button
                type="submit"
                disabled={releasePending}
                className="w-full px-4 py-2 border border-red-300 hover:bg-red-50 text-red-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {releasePending ? "Releasing…" : "Release venue"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
