/**
 * Pure Consumer/Business login & recovery outcome decisions.
 *
 * Consumer and Operator experiences share one Supabase Auth identity store
 * (see CLAUDE.md's Authentication & Email section) — the same email/password
 * may legitimately have Consumer access, Operator access, or both. Which
 * HHC experience a successfully-authenticated identity is allowed into is
 * therefore NOT a property of authentication succeeding; it's a property of
 * which application context the person entered through, cross-referenced
 * against which role(s) that identity actually has. These two functions are
 * the single source of truth for that decision, used by both the Consumer
 * Login (src/app/(consumer-auth)/sign-in/page.tsx) and Business Login
 * (src/app/login/page.tsx) post-authentication checks, and by the Consumer
 * recovery-completion context check (src/app/(consumer-auth)/account/
 * reset-password/page.tsx).
 *
 * No Supabase/DB I/O — the two booleans are resolved separately by
 * src/lib/postAuthAccess.ts (hasConsumerProfile / hasOperatorAccess) so this
 * file has a clean dependency-injection seam and can be unit-tested directly
 * (see tests/unit/auth/accessOutcome.test.ts), matching the pattern already
 * used for computeActiveVenueId (src/lib/impersonation.ts).
 */

export type AccountAccess = {
  isConsumer: boolean;
  isOperator: boolean;
};

export type LoginContext = "consumer" | "business";

/**
 * "granted"       — this identity has the role the entered context requires;
 *                    proceed into that experience.
 * "wrong-context"  — authentication succeeded, but the required role belongs
 *                    to the OTHER experience. Never grant access; the caller
 *                    shows role-specific messaging with a direct route into
 *                    the correct experience.
 * "no-account"    — authentication succeeded but this identity has neither
 *                    role (should not normally occur for a real account —
 *                    handled so the UI never dead-ends silently).
 */
export type LoginOutcome = "granted" | "wrong-context" | "no-account";

export function resolveLoginOutcome(
  context: LoginContext,
  access: AccountAccess
): LoginOutcome {
  const hasRequiredAccess = context === "consumer" ? access.isConsumer : access.isOperator;
  if (hasRequiredAccess) return "granted";

  const hasOtherAccess = context === "consumer" ? access.isOperator : access.isConsumer;
  return hasOtherAccess ? "wrong-context" : "no-account";
}

/**
 * Where a password-recovery completion should land, given the account access
 * of the identity that just verified its recovery token and updated its
 * password. Only used by the Consumer recovery flow (Business recovery
 * always lands back in the Business context by construction — see
 * src/app/operator/create-password/page.tsx) — this is what lets an
 * Operator-only identity that accidentally used Consumer recovery still get
 * a safe, correct outcome (the shared Auth password updates either way; this
 * decides what happens to the person afterward):
 *
 * "consumer-context"      — a consumer_profiles row exists; stay in the
 *                            Consumer experience (also covers a dual-role
 *                            Consumer+Operator identity, who intentionally
 *                            used Consumer recovery).
 * "business-continuation" — no consumer_profiles row, but this identity has
 *                            Business/Operator access; do not manufacture a
 *                            Consumer account — offer a direct continuation
 *                            into the Business/Operator experience instead.
 * "no-account"            — neither role. Should not normally occur; the
 *                            caller falls back to a generic completion state.
 */
export type RecoveryOutcome = "consumer-context" | "business-continuation" | "no-account";

export function resolveConsumerRecoveryOutcome(access: AccountAccess): RecoveryOutcome {
  if (access.isConsumer) return "consumer-context";
  if (access.isOperator) return "business-continuation";
  return "no-account";
}

/**
 * Whether a signed-in identity reaching /admin/* (src/app/admin/layout.tsx)
 * must be turned away before resolveOperatorContext() is ever called.
 *
 * This is the gate that stops a Consumer-only (or otherwise non-Operator)
 * identity from ever reaching resolveOperatorContext()'s final fallback —
 * ensureOperatorForSession — which auto-provisions a brand-new `operators`
 * row for any authenticated user with no existing operator/membership row.
 * That fallback exists as a safety net for genuine operators (see
 * ensureOperator.ts's header comment), not as an implicit "sign up as an
 * operator by visiting /admin" flow.
 *
 * Impersonation is exempt: a Founder/CP-admin's own identity is never
 * expected to have Business access itself — that path is authorized
 * separately via the impersonation session cookie, not this check.
 */
export function shouldBlockAdminAccess(params: {
  isImpersonating: boolean;
  hasOperatorAccess: boolean;
}): boolean {
  return !params.isImpersonating && !params.hasOperatorAccess;
}
