"use server";

import { extendActivationDeadlineImpl, type ExtendDeadlineState } from "@/lib/activation/extendActivationDeadlineImpl";

/**
 * Founder-only "Extend deadline by 7 days" Server Action — the actual
 * implementation lives in extendActivationDeadlineImpl.ts, a plain module
 * with NO "use server" directive, so it is never itself a network-callable
 * Server Action. That's where the dependency-injection seam for tests lives
 * (ExtendActivationDeadlineDeps) — tests import that module directly, never
 * through this file.
 *
 * This exported action is a thin, FIXED-signature wrapper: a browser/client
 * can only ever supply (lifecycleId is server-bound; prevState, formData) —
 * there is no parameter here capable of overriding authorization, the
 * Supabase clients, revalidation, or anything else this flow depends on.
 * Deliberately NOT re-exported from here (even a plain `export ... from`
 * re-export of the impl risks being swept into the "use server" transform
 * in some toolchains) — this file only ever defines and exports the one
 * fixed-signature action below.
 *
 * See extendActivationDeadlineImpl() for the full four-state extend/reopen
 * rules, the atomic compare-and-swap, and the structured note it writes.
 *
 * lifecycleId is bound via .bind(null, lifecycleId) — never read from FormData.
 */
export async function extendActivationDeadlineAction(
  lifecycleId: string,
  _prevState: ExtendDeadlineState,
  _formData: FormData
): Promise<ExtendDeadlineState> {
  return extendActivationDeadlineImpl(lifecycleId);
}

export type { ExtendDeadlineState };
