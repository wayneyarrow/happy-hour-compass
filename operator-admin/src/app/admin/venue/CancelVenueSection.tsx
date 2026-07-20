"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelVenueAction, type CancellationReason, type CancelVenueState } from "./cancelActions";
import { changePlanAction } from "@/app/admin/subscription/changePlanAction";
import type { OperatorPlan } from "@/lib/plans";

// ── Reason options ─────────────────────────────────────────────────────────────

const REASONS: { value: CancellationReason; label: string }[] = [
  { value: "business_closed",  label: "Business closed" },
  { value: "not_interested",   label: "Not interested right now" },
  { value: "duplicate_listing", label: "Duplicate or incorrect listing" },
  { value: "not_enough_value", label: "Not seeing enough value" },
  { value: "other",            label: "Other" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = "idle" | "paid-save-path" | "confirm";

const PAID_PLANS: OperatorPlan[] = ["pro", "premium", "enterprise"];

// ── Component ─────────────────────────────────────────────────────────────────

export default function CancelVenueSection({
  venueId,
  operatorId,
  currentPlan,
  isOwner,
}: {
  venueId:     string;
  operatorId:  string;
  currentPlan: OperatorPlan;
  isOwner:     boolean;
}) {
  const router = useRouter();
  const isPaidPlan = PAID_PLANS.includes(currentPlan);

  const [step, setStep]     = useState<Step>("idle");
  const [reason, setReason] = useState<CancellationReason>("business_closed");

  // Switch-to-free transition (save path)
  const [isSwitching, startSwitchTransition] = useTransition();
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Full cancellation
  const [state, formAction, isCancelling] = useActionState<CancelVenueState, FormData>(
    cancelVenueAction,
    {}
  );

  function handleCancelClick() {
    if (!isOwner) return;
    if (isPaidPlan) {
      setStep("paid-save-path");
    } else {
      setStep("confirm");
    }
  }

  function handleSwitchToFree() {
    setSwitchError(null);
    startSwitchTransition(async () => {
      const result = await changePlanAction(operatorId, "free");
      if (result.ok) {
        router.push("/admin/subscription");
      } else {
        setSwitchError(result.error ?? "Could not switch plan. Please try again.");
      }
    });
  }

  // ── Success: trigger layout re-render so the cancellation guard kicks in ──
  // router.refresh() re-runs server components including the layout, which
  // detects cancelled_at and swaps to the full farewell screen.
  useEffect(() => {
    if (state.success) {
      router.refresh();
    }
  }, [state.success, router]);

  if (state.success) {
    return (
      <div className="mt-10 pt-8 border-t border-gray-200">
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm text-gray-500">Just a moment…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10 pt-8 border-t border-gray-200">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
        Account
      </p>

      {/* ── Step: idle ──────────────────────────────────────────────────────── */}
      {step === "idle" && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">Cancel venue account</p>
            <p className="text-xs text-gray-500 mt-0.5">
              End this venue&rsquo;s relationship with Happy Hour Compass.
            </p>
            {!isOwner && (
              <p className="text-xs text-gray-400 mt-1">
                Only the account owner can cancel the venue.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleCancelClick}
            disabled={!isOwner}
            title={!isOwner ? "Only the account owner can cancel the venue." : undefined}
            className="px-4 py-2 rounded-lg border border-red-200 bg-white text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            Cancel venue account
          </button>
        </div>
      )}

      {/* ── Step: paid-save-path ────────────────────────────────────────────── */}
      {step === "paid-save-path" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Want to keep your listing live for free?
            </p>
            <p className="text-sm text-amber-800 mt-1 leading-relaxed">
              You can switch to the Free plan to stay listed on Happy Hour Compass
              without any cost — your venue will remain active and publicly visible.
            </p>
          </div>

          {switchError && (
            <p className="text-sm text-red-700 bg-white border border-red-200 rounded-lg px-3 py-2">
              {switchError}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSwitchToFree}
              disabled={isSwitching}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {isSwitching ? "Switching…" : "Switch to Free Plan"}
            </button>
            <button
              type="button"
              onClick={() => setStep("confirm")}
              disabled={isSwitching}
              className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Continue cancelling
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              disabled={isSwitching}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Go back
            </button>
          </div>
        </div>
      )}

      {/* ── Step: confirm ───────────────────────────────────────────────────── */}
      {step === "confirm" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-red-800">
              Are you sure you want to cancel your venue account?
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-red-700">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-red-400">•</span>
                Your venue will no longer appear publicly on Happy Hour Compass.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-red-400">•</span>
                The venue will be unpublished.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-red-400">•</span>
                Historical data, claim history, and analytics will be preserved.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-red-400">•</span>
                The founder will be notified.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-red-400">•</span>
                This does not delete the venue.
              </li>
              {isPaidPlan && (
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-red-400">•</span>
                  Your paid plan will be downgraded to Free.
                </li>
              )}
            </ul>
          </div>

          <div>
            <label htmlFor="cancel-reason" className="block text-xs font-semibold text-red-800 mb-1">
              Reason for cancellation
            </label>
            <select
              id="cancel-reason"
              value={reason}
              onChange={e => setReason(e.target.value as CancellationReason)}
              className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm bg-white text-gray-800 focus:ring-2 focus:ring-red-300 focus:outline-none"
            >
              {REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {state.error && (
            <p className="text-sm text-red-700 bg-white border border-red-200 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}

          <form action={formAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="venue_id" value={venueId} />
            <input type="hidden" name="reason"   value={reason}  />
            <button
              type="submit"
              disabled={isCancelling}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {isCancelling ? "Cancelling…" : "Yes, cancel venue account"}
            </button>
            <button
              type="button"
              onClick={() => setStep(isPaidPlan ? "paid-save-path" : "idle")}
              disabled={isCancelling}
              className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Keep my account
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
