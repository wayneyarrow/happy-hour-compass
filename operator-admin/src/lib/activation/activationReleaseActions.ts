"use server";

import { releaseActivationLifecycleImpl, type ReleaseActivationState } from "@/lib/activation/activationReleaseImpl";

/**
 * Founder-only "Release" Server Action (Phase 2A-4) — the actual
 * implementation lives in activationReleaseImpl.ts, a plain module with NO
 * "use server" directive, so it is never itself a network-callable Server
 * Action. That's where the dependency-injection seam for tests lives
 * (ReleaseActivationLifecycleDeps) — tests import that module directly,
 * never through this file. Same architecture as
 * activationLifecycleActions.ts / legacyActivationResumeActions.ts.
 *
 * This exported action is a thin, FIXED-signature wrapper: a browser/client
 * can only ever supply (lifecycleId is server-bound; prevState, formData) —
 * there is no parameter here capable of overriding authorization, which
 * origin type to use, which venue to release, the deadline/expiry state, or
 * eligibility — everything is re-resolved server-side from the lifecycle id
 * alone. lifecycleId is bound via .bind(null, lifecycleId) — never read from
 * FormData.
 *
 * One action, not one per origin type — the lifecycle row itself already
 * carries origin_type/origin_claim_id/origin_submission_id, so
 * releaseActivationLifecycleImpl() resolves the correct origin internally,
 * exactly like extendActivationDeadlineAction().
 */
export async function releaseActivationLifecycleAction(
  lifecycleId: string,
  _prevState: ReleaseActivationState,
  _formData: FormData
): Promise<ReleaseActivationState> {
  return releaseActivationLifecycleImpl(lifecycleId);
}

export type { ReleaseActivationState };
