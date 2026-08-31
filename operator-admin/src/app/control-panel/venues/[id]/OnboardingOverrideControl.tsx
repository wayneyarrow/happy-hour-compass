"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  markOnboardingCompleteAction,
  clearOnboardingOverrideAction,
  type VenueActionResult,
} from "./actions";
import { formatDateTime } from "@/lib/controlPanelDateTime";
import type { OnboardingCompletionMode } from "@/lib/homepagePhase";

type Props = {
  venueId: string;
  onboardingCompletionMode: OnboardingCompletionMode;
  setupHealthScorePct: number;
  missingItems: string[];
  overrideAt: string | null;
  overrideByEmail: string | null;
  overrideReason: string | null;
};

const INITIAL_STATE: VenueActionResult = { success: false, error: "" };

/**
 * Founder Control Panel manual onboarding-completion override (Phase 1B).
 * Mirrors the confirm-step / reason-form pattern established by
 * GoogleIdentityPanel's "Mark as exempt" / "Clear exemption" controls.
 *
 * Effective onboarding completion is automaticComplete OR manualOverrideActive
 * (computeEffectiveOnboarding(), src/lib/homepagePhase.ts) — this control only
 * ever writes the override; the automatic calculation is untouched and always
 * takes over again the moment the override is cleared.
 */
export default function OnboardingOverrideControl({
  venueId,
  onboardingCompletionMode,
  setupHealthScorePct,
  missingItems,
  overrideAt,
  overrideByEmail,
  overrideReason,
}: Props) {
  const router = useRouter();
  const [showMarkForm, setShowMarkForm] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundMark = (markOnboardingCompleteAction as any).bind(null, venueId);
  const [markState, markFormAction, markPending] =
    useActionState<VenueActionResult, FormData>(boundMark, INITIAL_STATE);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundClear = (clearOnboardingOverrideAction as any).bind(null, venueId);
  const [clearState, clearFormAction, clearPending] =
    useActionState<VenueActionResult, FormData>(boundClear, INITIAL_STATE);

  const isAnyPending = markPending || clearPending;

  // Refresh server-rendered venue data once after each successful persist —
  // matches GoogleIdentityPanel / ReactivateVenuePanel's established pattern.
  const didRefreshMark = useRef(false);
  useEffect(() => {
    if (markState.success && !didRefreshMark.current) {
      didRefreshMark.current = true;
      setShowMarkForm(false);
      router.refresh();
    }
    if (!markState.success) didRefreshMark.current = false;
  }, [markState.success, router]);

  const didRefreshClear = useRef(false);
  useEffect(() => {
    if (clearState.success && !didRefreshClear.current) {
      didRefreshClear.current = true;
      router.refresh();
    }
    if (!clearState.success) didRefreshClear.current = false;
  }, [clearState.success, router]);

  const missingSummary =
    missingItems.length > 0 ? missingItems.join(", ") : "None — every automatic item is complete";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Onboarding
        </h2>
        {onboardingCompletionMode === "manual" ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 border border-purple-300">
            Complete — Manual
          </span>
        ) : onboardingCompletionMode === "automatic" ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-300">
            Complete
          </span>
        ) : (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-300">
            Still Onboarding
          </span>
        )}
      </div>

      {/* Setup score + missing items — always shown, independent of override.
          A manually-completed venue can legitimately show a score below
          100% and still list missing items; this is never hidden. */}
      <dl className="space-y-2 text-sm mb-4">
        <div className="flex gap-3">
          <dt className="text-gray-400 w-36 shrink-0">Setup health score</dt>
          <dd className="text-gray-800">{setupHealthScorePct}%</dd>
        </div>
        <div className="flex gap-3">
          <dt className="text-gray-400 w-36 shrink-0">Missing (automatic)</dt>
          <dd className="text-gray-600">{missingSummary}</dd>
        </div>
      </dl>

      {"error" in markState && markState.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {markState.error}
        </div>
      )}
      {"error" in clearState && clearState.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {clearState.error}
        </div>
      )}

      {/* ── A. Automatically complete — no override needed ─────────────── */}
      {onboardingCompletionMode === "automatic" && (
        <p className="text-sm text-gray-500">
          Every automatic onboarding requirement is satisfied. No manual override is necessary.
        </p>
      )}

      {/* ── C. Manually complete ─────────────────────────────────────────── */}
      {onboardingCompletionMode === "manual" && (
        <div className="space-y-3">
          <dl className="space-y-2 text-sm bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-purple-700">Reason</dt>
              <dd className="text-gray-800 mt-0.5 whitespace-pre-wrap">
                {overrideReason ?? <span className="text-gray-400 italic">Not recorded</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-purple-700">
                Marked complete
              </dt>
              <dd className="text-gray-800 mt-0.5">
                {overrideAt ? formatDateTime(overrideAt) : <span className="text-gray-400 italic">—</span>}
                {overrideByEmail && <span className="text-gray-500"> · {overrideByEmail}</span>}
              </dd>
            </div>
          </dl>

          <form action={clearFormAction} className="space-y-2">
            <label className="block text-xs text-gray-500">Reason for clearing (optional)</label>
            <textarea
              name="reason"
              rows={2}
              placeholder="e.g. Venue added food specials — no longer needs the override."
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
            />
            <button
              type="submit"
              disabled={isAnyPending}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {clearPending ? "Clearing…" : "Clear Manual Completion"}
            </button>
            <p className="text-xs text-gray-400">
              Returns this venue to the normal, dynamically calculated onboarding status. If the
              automatic requirements are still unmet, the venue immediately shows as still onboarding
              again everywhere (operator dashboard, Founder Dashboard, Action Center).
            </p>
          </form>
        </div>
      )}

      {/* ── B. Incomplete — offer the override ──────────────────────────── */}
      {onboardingCompletionMode === "incomplete" && (
        <div className="border-t border-gray-100 pt-4">
          {!showMarkForm ? (
            <button
              type="button"
              onClick={() => setShowMarkForm(true)}
              disabled={isAnyPending}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg disabled:opacity-40"
            >
              Mark Onboarding Complete
            </button>
          ) : (
            <form action={markFormAction} className="space-y-2">
              <label className="block text-xs text-gray-500">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                name="reason"
                rows={2}
                required
                placeholder='e.g. "Venue offers drink specials only; food specials are not applicable."'
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isAnyPending}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg disabled:opacity-40"
                >
                  {markPending ? "Saving…" : "Confirm — Mark Complete"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowMarkForm(false)}
                  disabled={isAnyPending}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Use this when the automatic requirements legitimately don&apos;t apply to this venue
                (e.g. a drink-only happy hour). This does not change the raw setup score or hide
                missing items — it only marks the venue as done for onboarding purposes.
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
