"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { reactivateVenueAction, type VenueActionResult } from "./actions";
import { formatDate } from "@/lib/controlPanelDateTime";

type Step = "idle" | "confirm";

export default function ReactivateVenuePanel({
  venueId,
  cancelledAt,
  cancellationReason,
}: {
  venueId:            string;
  cancelledAt:        string;
  cancellationReason: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");

  const boundAction = reactivateVenueAction.bind(null, venueId);
  const [state, formAction, isPending] = useActionState<VenueActionResult, FormData>(
    boundAction,
    { success: false, error: "" }
  );

  if (state.success) {
    router.refresh();
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4">
        <p className="text-sm font-medium text-green-800">Venue reactivated.</p>
        <p className="text-xs text-green-700 mt-1">
          Cancellation cleared. Venue remains unpublished — publish it manually when ready.
        </p>
      </div>
    );
  }

  const fmtDate = formatDate(cancelledAt);

  return (
    <div className="space-y-3">
      {/* Cancellation summary */}
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 space-y-1.5">
        <p className="text-xs font-semibold text-rose-800 uppercase tracking-wide">
          Cancelled
        </p>
        <p className="text-sm text-rose-700">
          <span className="font-medium">{fmtDate}</span>
          {cancellationReason && (
            <span className="ml-2 text-rose-600">— {cancellationReason}</span>
          )}
        </p>
      </div>

      {step === "idle" && (
        <button
          type="button"
          onClick={() => setStep("confirm")}
          className="px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
        >
          Reactivate venue
        </button>
      )}

      {step === "confirm" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Confirm reactivation
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-amber-800">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-amber-500">•</span>
                The active cancellation will be cleared.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-amber-500">•</span>
                Venue becomes eligible to be managed again.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-amber-500">•</span>
                Venue will remain <strong>unpublished</strong> — it will not go live automatically.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-amber-500">•</span>
                Historical churn data, audit logs, and venue notes are preserved.
              </li>
            </ul>
          </div>

          {"error" in state && state.error && (
            <p className="text-sm text-red-700 bg-white border border-red-200 rounded-lg px-3 py-2">
              {state.error}
            </p>
          )}

          <form action={formAction} className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {isPending ? "Reactivating…" : "Confirm reactivation"}
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
