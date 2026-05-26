"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { resendClaimSetupEmailAction, type ResendSetupEmailState } from "./actions";

const INITIAL_STATE: ResendSetupEmailState = {};

export default function ResendSetupEmailPanel({ claimId }: { claimId: string }) {
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundAction = (resendClaimSetupEmailAction as any).bind(null, claimId);
  const [state, formAction, pending] = useActionState<ResendSetupEmailState, FormData>(
    boundAction,
    INITIAL_STATE
  );

  const didRefresh = useRef(false);
  useEffect(() => {
    if (state.success && !didRefresh.current) {
      didRefresh.current = true;
      router.refresh();
    }
    if (!state.success) didRefresh.current = false;
  }, [state.success, router]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-1">
        Account recovery
      </h3>
      <p className="text-xs text-gray-400 mb-4">
        Generates a fresh setup link and resends it to the operator. Safe to
        use multiple times — no duplicate accounts are created.
      </p>

      {state.success && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          <span><strong>{state.successAction}</strong></span>
        </div>
      )}

      {state.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="w-full px-5 py-2.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? "Sending…" : "Resend setup email"}
        </button>
      </form>
    </div>
  );
}
