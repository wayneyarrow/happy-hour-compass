"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { extendActivationDeadlineAction, type ExtendDeadlineState } from "@/lib/activation/activationLifecycleActions";
import { formatDeadlineCountdown } from "@/lib/activation/activationState";
import { getActivationEventLabel } from "@/lib/activation/activationEvents";
import { formatDateTime } from "@/lib/controlPanelDateTime";
import ActivationBadge from "@/components/ActivationBadge";
import type { ActivationPresentation } from "@/lib/activation/activationPresentation";

/**
 * Shared "Activation" detail-page card (Phase 1B) — used by both the Claim
 * and Submission detail pages. Purely presentational plus the one founder
 * action that belongs here (Extend deadline by 7 days); the Resend action
 * stays in each flow's own ResendSetupEmailPanel since it sends a
 * flow-specific email template.
 *
 * Never creates a lifecycle merely by being rendered — `presentation` is
 * read-only data already fetched by the page; a `not_tracked` record renders
 * a quiet, minimal state with no fields to fill in.
 */

const INITIAL_STATE: ExtendDeadlineState = {};

export type LastActivationEvent = { eventType: string | null; createdAt: string } | null;

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="text-gray-400 w-28 shrink-0">{label}</dt>
      <dd className="text-gray-800 min-w-0 break-words">{children}</dd>
    </div>
  );
}

export default function ActivationCard({
  presentation,
  lastEvent,
}: {
  presentation: ActivationPresentation;
  lastEvent: LastActivationEvent;
}) {
  const router = useRouter();
  const { state: activationState, lifecycle, operator } = presentation;

  const boundAction = lifecycle
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (extendActivationDeadlineAction as any).bind(null, lifecycle.id)
    : async () => INITIAL_STATE;
  const [formState, formAction, pending] = useActionState<ExtendDeadlineState, FormData>(
    boundAction,
    INITIAL_STATE
  );

  const didRefresh = useRef(false);
  useEffect(() => {
    if (formState.success && !didRefresh.current) {
      didRefresh.current = true;
      router.refresh();
    }
    if (!formState.success) didRefresh.current = false;
  }, [formState.success, router]);

  const canExtend = !!lifecycle && !lifecycle.releasedAt && activationState !== "active";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Activation</h3>
        <ActivationBadge state={activationState} />
      </div>

      {!lifecycle ? (
        <p className="text-sm text-gray-400 italic">
          Not tracked — no activation lifecycle exists for this record.
        </p>
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
              <span className="text-gray-500">No automated reminders sent</span>
            </MetaRow>
            {operator?.accountActivatedAt && (
              <MetaRow label="Activated">
                <span className="text-green-700 font-medium">{formatDateTime(operator.accountActivatedAt)}</span>
              </MetaRow>
            )}
            {lifecycle.expiredAt && <MetaRow label="Expired">{formatDateTime(lifecycle.expiredAt)}</MetaRow>}
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

          {formState.error && (
            <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {formState.error}
            </div>
          )}
          {formState.success && (
            <div className="mb-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              {formState.successAction}
            </div>
          )}

          {canExtend && (
            <form
              action={formAction}
              onSubmit={(e) => {
                if (!window.confirm("Extend this activation deadline by 7 days?")) {
                  e.preventDefault();
                }
              }}
            >
              <button
                type="submit"
                disabled={pending}
                className="w-full px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {pending ? "Extending…" : "Extend deadline by 7 days"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
