/**
 * Recipient resolution for Customer Success milestone delivery (Phase 1B).
 *
 * CANONICAL MODEL (investigated, not assumed):
 *   operator_memberships (migration 037_operator_memberships.sql) is HHC's
 *   one existing multi-user access model: role IN ('owner','member'),
 *   status IN ('active','invited','cancelled'). Every operator account
 *   automatically gets an 'owner'/'active' membership row via a DB trigger
 *   (on_operator_created) the moment the operator row is created — this is
 *   the canonical "designated admin/primary account user" signal, not
 *   something this module invents. A team member (role='member') is added
 *   later via the existing invite flow and only becomes 'active' once they
 *   accept.
 *
 *   This module only ever queries operator_memberships, scoped to the
 *   venue's owning operator_id — consumer_profiles is never touched, so a
 *   consumer account can never be selected as a milestone-email recipient.
 *
 * OWNER UNIQUENESS (investigated, not assumed — Correction Pass Section 3):
 *   migration 037 constrains only UNIQUE(operator_id, email) — there is NO
 *   partial unique index enforcing "at most one role='owner' row per
 *   operator_id" at the database level. In practice exactly one owner row
 *   ever exists per operator, because application code never writes
 *   role='owner' anywhere — the ONLY place that value is ever written is
 *   the create_owner_membership_on_operator_insert trigger (fires once,
 *   on operator creation), and the team-invite flow
 *   (app/admin/users/actions.ts) always writes role: "member" for invited
 *   users. But that is an application-code guarantee, not a schema-enforced
 *   one, so this resolver treats it defensively rather than assuming it: it
 *   never picks "the first owner row" — it checks the COUNT of active
 *   owners.
 *
 * RULE (Section 2, hardened per Section 3):
 *   1. Preferred  — EXACTLY ONE active 'owner' membership → use it.
 *   2. Blocked    — 2+ active 'owner' memberships → 'ambiguous_recipient'.
 *                    Never arbitrarily picks the first one.
 *   3. Fallback   — zero active owners, but exactly one active membership
 *                    of any role → use it.
 *   4. Blocked    — zero active memberships at all → 'no_active_recipient'.
 *   5. Blocked    — zero active owners, 2+ active non-owner memberships →
 *                    'ambiguous_recipient'. Never guessed.
 *
 *   A membership with a blank/whitespace-only email is treated as if it
 *   didn't exist for selection purposes (Section 4) — sending to an empty
 *   address is never acceptable regardless of role.
 */

import { createAdminClient } from "@/lib/supabase/server";

/**
 * Reasons a Customer Success delivery cannot proceed for a data-resolution
 * reason (not a provider/Resend failure). Covers both "no valid recipient"
 * (Section 2) and "no resolvable venue timezone" (Section 4,
 * deliveryScheduling.ts) — same recoverable-and-notify-once mechanism,
 * see customer_success_events.recipient_blocked_reason (migration
 * 095_customer_success_delivery.sql).
 */
export type DeliveryBlockedReason = "no_active_recipient" | "ambiguous_recipient" | "no_resolvable_timezone";

export type ResolvedRecipient = {
  email: string;
  /** First token of the membership's full_name; "there" if unset (e.g. "Hi there,"). */
  firstName: string;
  role: "owner" | "member";
};

export type RecipientResolution =
  | { ok: true; recipient: ResolvedRecipient }
  | { ok: false; reason: Extract<DeliveryBlockedReason, "no_active_recipient" | "ambiguous_recipient"> };

export type ActiveMembershipLike = {
  role: "owner" | "member";
  email: string;
  fullName: string | null;
};

function firstNameFrom(fullName: string | null): string {
  if (!fullName) return "there";
  const first = fullName.trim().split(/\s+/)[0];
  return first || "there";
}

function hasUsableEmail(m: ActiveMembershipLike): boolean {
  return typeof m.email === "string" && m.email.trim().length > 0;
}

function toRecipient(m: ActiveMembershipLike): ResolvedRecipient {
  return { email: m.email.trim(), firstName: firstNameFrom(m.fullName), role: m.role };
}

/** Pure decision — see module header for the exact rule. */
export function resolveRecipientFromActiveMemberships(
  memberships: readonly ActiveMembershipLike[]
): RecipientResolution {
  // A blank/whitespace-only email can never be a valid recipient, whatever
  // the role — excluded up front rather than special-cased per branch.
  const usable = memberships.filter(hasUsableEmail);

  const owners = usable.filter((m) => m.role === "owner");
  if (owners.length === 1) {
    return { ok: true, recipient: toRecipient(owners[0]) };
  }
  if (owners.length > 1) {
    // Never arbitrarily pick the first — see OWNER UNIQUENESS above.
    return { ok: false, reason: "ambiguous_recipient" };
  }

  // Zero active owners.
  if (usable.length === 1) {
    return { ok: true, recipient: toRecipient(usable[0]) };
  }
  if (usable.length === 0) {
    return { ok: false, reason: "no_active_recipient" };
  }
  return { ok: false, reason: "ambiguous_recipient" };
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** Every status='active' membership for `operatorId`. */
export async function getActiveOperatorMemberships(
  operatorId: string,
  admin: AdminClient
): Promise<ActiveMembershipLike[]> {
  const { data, error } = await admin
    .from("operator_memberships")
    .select("role, email, full_name")
    .eq("operator_id", operatorId)
    .eq("status", "active");

  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    role: (r as { role: string }).role === "owner" ? "owner" : "member",
    email: (r as { email: string }).email,
    fullName: (r as { full_name: string | null }).full_name,
  }));
}

/** Impure entry point: fetches active memberships for `operatorId` and resolves the recipient. */
export async function resolveRecipientForOperator(
  operatorId: string,
  admin: AdminClient
): Promise<RecipientResolution> {
  const memberships = await getActiveOperatorMemberships(operatorId, admin);
  return resolveRecipientFromActiveMemberships(memberships);
}
