"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  sendClaimFinalSetupEmailAction,
  sendSubmissionFinalSetupEmailAction,
  generateClaimFinalSetupLinkAction,
  generateSubmissionFinalSetupLinkAction,
  type FinalSetupEmailState,
} from "@/lib/activation/finalSetupFollowUpActions";
import { formatDateTime } from "@/lib/controlPanelDateTime";

const INITIAL_STATE: FinalSetupEmailState = {};

type CopiedLink = { link: string; expiresAt: string; copied: boolean; warning?: string };

/**
 * Post-expiry "Final follow-up" section on Claim/Submission detail pages —
 * replaces the normal Resend panel once the setup window has ended without
 * account setup. Every eligibility rule is re-checked server-side at submit
 * time (finalSetupFollowUpImpl.ts); this component only renders controls.
 *
 * The copied link is held in component state only for display/copy — never
 * logged, stored, or sent anywhere by this component.
 */
export default function FinalSetupFollowUpPanel({
  origin,
  recipientEmail,
}: {
  origin: { type: "claim"; claimId: string } | { type: "submission"; submissionId: string };
  recipientEmail: string | null;
}) {
  const router = useRouter();
  const recipient = recipientEmail ?? "the operator";

  const boundSend =
    origin.type === "claim"
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sendClaimFinalSetupEmailAction as any).bind(null, origin.claimId)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sendSubmissionFinalSetupEmailAction as any).bind(null, origin.submissionId);
  const [sendState, sendFormAction, sendPending] = useActionState<FinalSetupEmailState, FormData>(boundSend, INITIAL_STATE);

  const didRefresh = useRef(false);
  useEffect(() => {
    if (sendState.success && !didRefresh.current) {
      didRefresh.current = true;
      router.refresh();
    }
    if (!sendState.success) didRefresh.current = false;
  }, [sendState.success, router]);

  const [copyPending, startCopy] = useTransition();
  const [copied, setCopied] = useState<CopiedLink | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  function handleCopy() {
    const confirmed = window.confirm(
      `Generate a new setup link for ${recipient}?\n\n` +
        "It expires in 24 hours. Any earlier setup link — including the last setup email — will stop working.\n\n" +
        "Automatic reminders stay stopped and the setup window is not extended."
    );
    if (!confirmed) return;
    setCopyError(null);
    setCopied(null);
    startCopy(async () => {
      const result =
        origin.type === "claim"
          ? await generateClaimFinalSetupLinkAction(origin.claimId)
          : await generateSubmissionFinalSetupLinkAction(origin.submissionId);
      if (!result.ok) {
        setCopyError(result.error);
        return;
      }
      let didCopy = false;
      try {
        await navigator.clipboard.writeText(result.link);
        didCopy = true;
      } catch {
        // Some browsers refuse clipboard writes after an async round trip —
        // the link is shown below for a manual copy instead.
      }
      setCopied({ link: result.link, expiresAt: result.expiresAt, copied: didCopy, warning: result.warning });
      router.refresh();
    });
  }

  const busy = sendPending || copyPending;

  return (
    <div className="bg-white rounded-xl border border-amber-200 shadow-resting p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Final follow-up</h3>
        <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
          Setup window ended
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Automatic setup reminders have stopped. Use these for your personal follow-up with {recipient}.
      </p>

      {sendState.success && (
        <div className="mb-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          <strong>{sendState.successAction}.</strong> The link expires in 24 hours; earlier setup links no longer work.
          {sendState.warning && <span className="block mt-1 text-amber-700">{sendState.warning}</span>}
        </div>
      )}
      {sendState.error && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{sendState.error}</div>
      )}

      <form
        action={sendFormAction}
        onSubmit={(e) => {
          const confirmed = window.confirm(
            `Send a final setup email to ${recipient}?\n\n` +
              "It contains a fresh setup link that expires in 24 hours. Any earlier setup link will stop working.\n\n" +
              "Automatic reminders stay stopped and the setup window is not extended."
          );
          if (!confirmed) e.preventDefault();
        }}
      >
        <button
          type="submit"
          disabled={busy}
          className="w-full px-5 py-2.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sendPending ? "Sending…" : "Final resend setup email"}
        </button>
      </form>
      <p className="text-xs text-gray-400 mt-2 mb-4">
        Sends a fresh setup email for your final personal follow-up. Automatic reminders remain stopped, and the setup
        window is not extended.
      </p>

      {copyError && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{copyError}</div>
      )}
      {copied && (
        <div className="mb-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 space-y-2">
          <p>
            <strong>{copied.copied ? "Setup link copied." : "Setup link ready — copy it below."}</strong> Expires{" "}
            {formatDateTime(copied.expiresAt)} (24 hours). Any earlier setup link no longer works.
          </p>
          {!copied.copied && (
            <input
              readOnly
              value={copied.link}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full px-2 py-1.5 border border-green-300 rounded text-xs text-gray-700 bg-white"
              aria-label="Setup link"
            />
          )}
          {copied.warning && <p className="text-amber-700">{copied.warning}</p>}
        </div>
      )}

      <button
        type="button"
        onClick={handleCopy}
        disabled={busy}
        className="w-full px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {copyPending ? "Generating…" : "Copy setup link"}
      </button>
      <p className="text-xs text-gray-400 mt-2">
        Copies a &ldquo;Finish your setup&rdquo; link to paste into your own email thread. It expires in 24 hours and
        replaces any earlier setup link. The operator clicks Continue, then chooses a password.
      </p>
    </div>
  );
}
