"use server";

import {
  sendFinalSetupEmailImpl,
  generateFinalSetupLinkImpl,
  type FinalSetupEmailState,
  type FinalSetupLinkResult,
} from "@/lib/activation/finalSetupFollowUpImpl";

/**
 * Thin, fixed-signature Server Action wrappers for the founder's post-expiry
 * final follow-up ("Final resend setup email" / "Copy setup link"). All
 * logic — authorization, eligibility, the setup-link lock, link generation,
 * and the test-only DI seam — lives in finalSetupFollowUpImpl.ts, which has
 * no "use server" directive and is never network-reachable. These wrappers
 * pass NO dependencies: a client can only supply the server-bound origin id
 * (and, for the form action, prevState/formData, which are ignored).
 */

export type { FinalSetupEmailState, FinalSetupLinkResult };

/** claimId is bound via .bind(null, claimId) — never read from FormData. */
export async function sendClaimFinalSetupEmailAction(
  claimId: string,
  _prevState: FinalSetupEmailState,
  _formData: FormData
): Promise<FinalSetupEmailState> {
  return sendFinalSetupEmailImpl({ type: "claim", claimId });
}

/** submissionId is bound via .bind(null, submissionId) — never read from FormData. */
export async function sendSubmissionFinalSetupEmailAction(
  submissionId: string,
  _prevState: FinalSetupEmailState,
  _formData: FormData
): Promise<FinalSetupEmailState> {
  return sendFinalSetupEmailImpl({ type: "submission", submissionId });
}

/** Returns a fresh setup link for the founder to paste into their own email. */
export async function generateClaimFinalSetupLinkAction(claimId: string): Promise<FinalSetupLinkResult> {
  return generateFinalSetupLinkImpl({ type: "claim", claimId });
}

/** Returns a fresh setup link for the founder to paste into their own email. */
export async function generateSubmissionFinalSetupLinkAction(submissionId: string): Promise<FinalSetupLinkResult> {
  return generateFinalSetupLinkImpl({ type: "submission", submissionId });
}
