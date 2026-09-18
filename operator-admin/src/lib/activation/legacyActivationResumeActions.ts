"use server";

import { revalidatePath } from "next/cache";
import {
  resumeLegacyClaimActivationImpl,
  resumeLegacySubmissionActivationImpl,
  type LegacyActivationResumeState,
} from "@/lib/activation/legacyActivationResumeImpl";

/**
 * Two thin, fixed-signature Server Action wrappers for the Phase 1C
 * controlled legacy-activation-resume flow. The real logic — including the
 * dependency-injection seam used only by tests — lives entirely in
 * legacyActivationResumeImpl.ts, a plain module with NO "use server"
 * directive, so it is never itself network-reachable. These wrappers call
 * it with NO caller-supplied dependencies: a browser/client can only ever
 * supply (id is server-bound; prevState, formData) — there is no parameter
 * here capable of overriding authorization, the Supabase clients, email
 * delivery, or anything else this flow depends on. Deliberately NOT
 * re-exported from the impl module (even a plain `export ... from`
 * re-export risks being swept into the "use server" transform in some
 * toolchains) — this file only ever defines and exports these two
 * fixed-signature actions.
 */

export type { LegacyActivationResumeState };

/**
 * Starts controlled legacy activation tracking for a Claim's operator and
 * sends their setup email. See resumeLegacyClaimActivationImpl() for the
 * full eligibility rules, sequencing, and failure-mode behavior.
 *
 * claimId is bound via .bind(null, claimId) — never read from FormData.
 */
export async function resumeLegacyClaimActivationAction(
  claimId: string,
  _prevState: LegacyActivationResumeState,
  _formData: FormData
): Promise<LegacyActivationResumeState> {
  const result = await resumeLegacyClaimActivationImpl(claimId);
  if (result.success) {
    revalidatePath("/control-panel/claims");
    revalidatePath(`/control-panel/claims/${claimId}`);
  }
  return result;
}

/**
 * Starts controlled legacy activation tracking for a Submission's operator
 * and sends their setup email. See resumeLegacySubmissionActivationImpl()
 * for the full eligibility rules, sequencing, and failure-mode behavior.
 *
 * submissionId is bound via .bind(null, submissionId) — never read from FormData.
 */
export async function resumeLegacySubmissionActivationAction(
  submissionId: string,
  _prevState: LegacyActivationResumeState,
  _formData: FormData
): Promise<LegacyActivationResumeState> {
  const result = await resumeLegacySubmissionActivationImpl(submissionId);
  if (result.success) {
    revalidatePath("/control-panel/operator-submissions");
    revalidatePath(`/control-panel/operator-submissions/${submissionId}`);
  }
  return result;
}
