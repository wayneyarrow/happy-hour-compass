import { createClient, createAdminClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { sendPasswordSetupEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/siteUrl";
import { getActivationPresentationForClaim } from "@/lib/activation/activationPresentation";

/**
 * Implementation for resendClaimSetupEmailAction, deliberately kept OUT of
 * the "use server" actions.ts file (Phase 1B correction).
 *
 * WHY: Next.js treats every exported async function in a "use server" file
 * as a real, network-callable Server Action — including one exported only
 * "for testing." A prior version of this fix put a `deps` override
 * parameter directly on the exported action so tests could inject a fake
 * Supabase client / admin-check; that made `checkAdmin` (the stand-in for
 * isControlPanelAdmin) a parameter that technically existed on a public RPC
 * surface, which a code-review flagged as a defect regardless of whether
 * today's Next.js transport happens to make it hard to exploit — an
 * exported action's signature should contain nothing but legitimate client
 * inputs. This file has no "use server" directive at all, so it is never
 * treated as an action and is never network-reachable: it's an ordinary
 * module, importable only from other server-side code (or tests) within
 * this app. actions.ts's exported `resendClaimSetupEmailAction` is now a
 * thin, fixed-signature wrapper that calls this with no `deps` — a browser
 * request can only ever reach the fixed `(claimId, prevState, formData)`
 * signature and has no path to influence anything inside this function.
 *
 * See the module comment on ExtendActivationDeadlineDeps
 * (activationLifecycleActions.ts's sibling impl) for the identical pattern
 * applied to the other founder-only action with the same prior issue.
 */

export type ResendSetupEmailState = {
  success?: true;
  successAction?: string;
  error?: string;
};

/** Test-only DI — real callers (the "use server" wrapper) always omit this. */
export type ResendClaimSetupEmailDeps = {
  authClient?: Awaited<ReturnType<typeof createClient>>;
  adminClient?: ReturnType<typeof createAdminClient>;
  checkAdmin?: (email: string | undefined) => Promise<boolean>;
};

/**
 * Resends the "set up your password" email to a claim-approved operator.
 *
 * Safe to call multiple times — generates a fresh Supabase recovery link each
 * time. Does NOT create a new auth user, a new operator row, or alter venue
 * ownership. Appends an internal note on success.
 *
 * Eligibility: claim.status === "approved", email present, venue_id present,
 * an operator row exists for the email address, that operator is still
 * unactivated, and — if a lifecycle is tracked — it isn't released or past
 * its deadline.
 */
export async function resendClaimSetupEmailImpl(
  claimId: string,
  deps: ResendClaimSetupEmailDeps = {}
): Promise<ResendSetupEmailState> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  // Founder Control Panel action that sends account-access/setup email — must
  // require the same verified admin allowlist check as every other founder-
  // only mutation (resendSubmissionSetupEmailAction, extendActivationDeadlineAction,
  // etc.), not merely "is signed in." This runs BEFORE any claim, lifecycle,
  // recipient, or token/link inspection below — an ordinary authenticated
  // consumer/operator gets a generic "Unauthorized." with no claim/operator
  // details, matching every other founder-only action's denial shape.
  const authClient = deps.authClient ?? (await createClient());
  const { data: { user } } = await authClient.auth.getUser();
  const checkAdmin = deps.checkAdmin ?? isControlPanelAdmin;
  if (!user || !(await checkAdmin(user.email))) return { error: "Unauthorized." };

  const supabase = deps.adminClient ?? createAdminClient();

  // ── Fetch claim ───────────────────────────────────────────────────────────
  const { data: claimRow, error: fetchError } = await supabase
    .from("venue_claims")
    .select("email, first_name, venue_id, status")
    .eq("id", claimId)
    .single();

  if (fetchError || !claimRow) {
    console.error("[resendClaimSetupEmailImpl] Claim fetch failed:", fetchError?.message);
    return { error: "Claim not found. Please refresh and try again." };
  }

  // ── Eligibility ───────────────────────────────────────────────────────────
  if ((claimRow.status as string) !== "approved") {
    return { error: "Resend is only available for approved claims." };
  }

  const email     = claimRow.email as string;
  const firstName = ((claimRow.first_name as string | null) ?? "").trim() || "there";
  const venueId   = claimRow.venue_id as string | null;

  if (!email)   return { error: "Claim has no email address." };
  if (!venueId) return { error: "Claim is not linked to a venue." };

  // ── Confirm operator account exists ───────────────────────────────────────
  const { data: operatorRow } = await supabase
    .from("operators")
    .select("id, account_activated_at")
    .eq("email", email)
    .maybeSingle();

  if (!operatorRow?.id) {
    return {
      error:
        "No operator account found for this email. The claim may not have been " +
        "fully provisioned. Try re-approving the claim or contact support.",
    };
  }

  // ── Confirm operator is still unactivated ─────────────────────────────────
  // account_activated_at is the one authoritative activation signal (see
  // activationLifecycle.ts's header) — never inferred from lifecycle-row
  // existence alone.
  if (operatorRow.account_activated_at) {
    return { error: "This operator has already activated their account. No setup email is needed." };
  }

  // ── Activation lifecycle checks ────────────────────────────────────────────
  // No lifecycle row at all (not_tracked) is a legitimate legacy case — this
  // claim predates the Phase 1A lifecycle table, or activation is otherwise
  // untracked — and resend must keep working exactly as it always has.
  const presentation = await getActivationPresentationForClaim(claimId);
  if (presentation.lifecycle) {
    if (presentation.lifecycle.releasedAt) {
      return {
        error:
          "This activation has already been released. Resending a setup email is not " +
          "available — the venue may need to be re-claimed.",
      };
    }
    if (presentation.state === "release_required" || presentation.state === "expired") {
      return {
        error:
          "This activation's deadline has already passed. Extend the deadline before " +
          "resending the setup email, so the operator gets a working window to use it.",
      };
    }

    // ── Double-submit guard ──────────────────────────────────────────────────
    // No dedicated "last resend" column exists on venue_claims — reusing the
    // structured manual_resend note this action already writes on success is
    // a practical signal without a new migration. A genuine, deliberate
    // re-request (e.g. resending after a long wait) is still allowed; this
    // only suppresses a literal double-click/duplicate-submit landing within
    // the same short window — same idiom as reviewSubmissionAction's
    // RETRY_WINDOW_MS guard for needs_more_info.
    const RETRY_WINDOW_MS = 10_000;
    const { data: recentResendNotes } = await supabase
      .from("venue_claim_notes")
      .select("created_at")
      .eq("claim_id", claimId)
      .eq("event_type", "manual_resend")
      .order("created_at", { ascending: false })
      .limit(1);
    const lastResendAt = recentResendNotes?.[0]?.created_at as string | undefined;
    if (lastResendAt && Date.now() - new Date(lastResendAt).getTime() < RETRY_WINDOW_MS) {
      console.warn("[resendClaimSetupEmailImpl] Duplicate resend suppressed (retry window).", { claimId });
      return { success: true, successAction: `Setup email resent to ${email}` };
    }
  }

  // ── Generate fresh recovery link ──────────────────────────────────────────
  const appUrl     = getSiteUrl();
  const redirectTo = `${appUrl}/operator/create-password`;

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type:    "recovery",
    email,
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error("[resendClaimSetupEmailImpl] generateLink failed:", linkError?.message);
    return { error: "Failed to generate a new setup link. Please try again." };
  }

  // ── Send email (awaited — fail fast on error) ─────────────────────────────
  const emailResult = await sendPasswordSetupEmail({
    to:        email,
    firstName,
    setupLink: linkData.properties.action_link,
  });

  if (!emailResult.ok) {
    console.error(
      "[resendClaimSetupEmailImpl] Email send failed:",
      { claimId, email, error: emailResult.error }
    );
    return {
      error: `Email could not be sent to ${email} (${emailResult.error ?? "unknown error"}). Please try again.`,
    };
  }

  // ── Append structured internal note ───────────────────────────────────────
  // Founder-triggered, so attributed to the real signed-in founder — never
  // the "Happy Hour Compass" system-author string. Never stores the
  // generated link/token itself — only operational metadata.
  await supabase.from("venue_claim_notes").insert({
    claim_id:         claimId,
    note:             `Setup email resent to ${email} by founder.`,
    event_type:       "manual_resend",
    metadata_json: {
      recipient: email,
      sentAt: new Date().toISOString(),
      lifecycleId: presentation.lifecycle?.id ?? null,
      currentDeadline: presentation.lifecycle?.deadlineAt ?? null,
    },
    created_by:       user.id,
    created_by_email: user.email ?? null,
  });

  console.log("[resendClaimSetupEmailImpl] Complete.", { claimId, email });

  return { success: true, successAction: `Setup email resent to ${email}` };
}
