import { createAdminClient } from "@/lib/supabase/server";
import { sendSlackAlert } from "@/lib/slack";
import { sendOperatorAccountActivatedNotificationEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/siteUrl";
import { reportOperationalError } from "@/lib/observability/reportOperationalError";

// ── Observability ────────────────────────────────────────────────────────────
//
// This file is shared by FOUR call sites: Add Your Venue
// (suggest/owner/actions.ts), two founder Control Panel approval actions
// (control-panel/operator-submissions/[id]/actions.ts), and the founder's
// claim-approval action (control-panel/claims/[id]/actions.ts). It already
// had good #ops-critical Slack coverage for every failure branch below
// before this task — none of that is duplicated. Every branch calls
// reportOperationalError() (Sentry-only — never reportCriticalFailure(),
// which would fire a SECOND, competing Slack alert) exactly once, then
// folds the returned hhcErrorId/sentryEventId into the SAME pre-existing
// sendSlackAlert() call. Stage "rollback" covers all three rollback
// helpers (rbAuthUser/rbOperator/rbVenueLink) — which step's rollback
// failed is carried as safe context (`rollbackStep`), not a separate stage,
// since it's the same class of failure (an already-failed provisioning
// attempt's cleanup also failing) regardless of which resource it was.
//
// provisionOperatorForVenue()'s failure return now carries `hhcErrorId` and
// an `error` string that IS the standard buildInternalErrorMessage() output
// — this makes it the single source of truth for Sentry/HHC/Slack
// correlation for its own failures. Add Your Venue's outer "operator-provision"
// reporting (added in an earlier task, before this shared-caller picture was
// clear) has been removed accordingly — see that file's own comment at the
// call site for why a second report there would have duplicated this one.
const OPERATOR_ACTIVATION_FLOW = "operator-activation";

// KNOWN ISSUE: Supabase's GoTrue Admin API intermittently rejects calls with
// "unrecognized JWT kid <nil> for algorithm ES256" following the platform's
// HS256→ES256 JWT signing-key migration — a confirmed upstream bug, not a
// config/code issue (see supabase/supabase#48295, #48272). Remove the retry
// in provisionOperatorForVenue's generateLink step once Supabase ships a fix.
function isKnownSupabaseJwtKidError(message: string | null | undefined): boolean {
  return !!message && message.includes("unrecognized JWT kid") && message.includes("ES256");
}

/**
 * Provisions an operator account for a venue and sends an activation email.
 *
 * Steps (mirrors reviewClaimAction steps 2-6):
 *  1. Create Supabase Auth user (email_confirm: true, no password). If the
 *     user already exists, look up their ID + activation state from the
 *     operators table (retry).
 *  2. Insert operator row (id = auth user UUID). Idempotent on 23505 conflict.
 *  3. Link venue: set claimed_by, claimed_at, created_by_operator_id. Does
 *     NOT touch any other venue this operator already owns — see "Multi-venue
 *     ownership" below.
 *  4. Resolve the link to send: a real Supabase recovery link (pointing to
 *     /operator/create-password) for a genuinely new operator, or a plain
 *     /login link for a returning, already-activated operator — see
 *     "Returning operators" below.
 *  5. Call sendEmail(link, isReturningOperator) — rollback all prior steps
 *     on failure.
 *
 * Multi-venue ownership (Phase 1, 2026-08-29):
 *   This function used to unlink every other venue the operator owned before
 *   linking the new one — a "one-venue-per-operator" invariant enforced in
 *   code, not by the schema. That step is intentionally removed. An operator
 *   can now legitimately own more than one venue: `venues.created_by_operator_id`
 *   is a plain FK with no uniqueness constraint on the operator side, and
 *   Operator Admin now resolves an explicit active venue (see
 *   `src/lib/impersonation.ts`'s OperatorContext.venues/activeVenueId) rather
 *   than assuming exactly one row matches. Do not reintroduce an unlink step
 *   here without also revisiting that resolution logic.
 *
 * Returns { ok: true, authUserId } on success.
 * Returns { ok: false, error, hhcErrorId } on any step failure after full
 * rollback — `error` is already the standard support-reference customer
 * message (buildInternalErrorMessage() output) with `hhcErrorId` embedded;
 * callers should return it as-is rather than re-wrapping it.
 *
 * The sendEmail callback decouples email copy from provisioning logic,
 * allowing claim approvals and operator submissions to use different copy
 * without diverging the core provisioning flow.
 *
 * Returning operators (2026-08-30 follow-up to Phase 1 multi-venue support):
 *   `isReturningOperator` is true when this call reused an existing,
 *   already-activated operator account (i.e. this is a second-or-later
 *   venue for someone who has already set a password). In that case no
 *   Supabase recovery token is generated at all — see Step 4 — and
 *   `sendEmail` receives a plain /login link instead. Callers should send
 *   "venue added to your account" copy rather than "set up your password"
 *   copy in that case (see sendVenueAddedToAccountEmail in src/lib/email.ts).
 */
export async function provisionOperatorForVenue({
  email,
  firstName,
  lastName,
  venueId,
  logTag,
  sendEmail,
}: {
  email: string;
  firstName: string;
  lastName: string;
  venueId: string;
  /** Prefix for all log lines, e.g. "[saveOperatorSubmissionAction]" */
  logTag: string;
  sendEmail: (
    setupLink: string,
    isReturningOperator: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
}): Promise<{ ok: true; authUserId: string } | { ok: false; error: string; hhcErrorId?: string }> {
  const supabase = createAdminClient();
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

  // ── Local rollback helpers (capture supabase + logTag from outer scope) ──

  async function rbAuthUser(userId: string, context: string) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) {
      console.error(
        `${logTag} CRITICAL: ${context} — auth user rollback failed.`,
        { userId, rollbackError: error.message }
      );
      const report = reportOperationalError({
        error: new Error(error.message),
        flow: OPERATOR_ACTIVATION_FLOW,
        stage: "rollback",
        severity: "critical",
        context: { rollbackStep: "auth-user", authUserId: userId, callerFlow: logTag },
      });
      await sendSlackAlert({
        channel:  "ops-critical",
        severity: "critical",
        title:    "Operator Rollback Failed — Auth User Not Deleted",
        message:  `${context} — auth user rollback failed. Manual cleanup required.`,
        metadata: {
          Email: email, "User ID": userId, "Rollback Error": error.message,
          "HHC Error": report.hhcErrorId, "Sentry Event": report.sentryEventId ?? "unavailable",
        },
      });
    }
  }

  async function rbOperator(userId: string, context: string) {
    const { error } = await supabase.from("operators").delete().eq("id", userId);
    if (error) {
      console.error(
        `${logTag} CRITICAL: ${context} — operator rollback failed.`,
        { userId, rollbackError: error.message }
      );
      const report = reportOperationalError({
        error: new Error(error.message),
        flow: OPERATOR_ACTIVATION_FLOW,
        stage: "rollback",
        severity: "critical",
        context: { rollbackStep: "operator", authUserId: userId, callerFlow: logTag },
      });
      await sendSlackAlert({
        channel:  "ops-critical",
        severity: "critical",
        title:    "Operator Rollback Failed — Operator Row Not Deleted",
        message:  `${context} — operator row rollback failed. Manual cleanup required.`,
        metadata: {
          Email: email, "User ID": userId, "Rollback Error": error.message,
          "HHC Error": report.hhcErrorId, "Sentry Event": report.sentryEventId ?? "unavailable",
        },
      });
    }
  }

  async function rbVenueLink(vId: string, context: string) {
    const { error } = await supabase
      .from("venues")
      .update({ claimed_by: null, claimed_at: null, created_by_operator_id: null })
      .eq("id", vId);
    if (error) {
      console.error(
        `${logTag} CRITICAL: ${context} — venue link rollback failed.`,
        { venueId: vId, rollbackError: error.message }
      );
      const report = reportOperationalError({
        error: new Error(error.message),
        flow: OPERATOR_ACTIVATION_FLOW,
        stage: "rollback",
        severity: "critical",
        context: { rollbackStep: "venue-link", venueId: vId, callerFlow: logTag },
      });
      await sendSlackAlert({
        channel:  "ops-critical",
        severity: "critical",
        title:    "Operator Rollback Failed — Venue Link Not Cleared",
        message:  `${context} — venue link rollback failed. Manual cleanup required.`,
        metadata: {
          Email: email, "Venue ID": vId, "Rollback Error": error.message,
          "HHC Error": report.hhcErrorId, "Sentry Event": report.sentryEventId ?? "unavailable",
        },
      });
    }
  }

  // ── Step 1: Create Supabase Auth user ────────────────────────────────────

  let authUserId: string;
  let createdNewAuthUser = false;
  // True when this call reused an existing, already-activated operator
  // account — i.e. this is a second-or-later venue for someone who has
  // already completed account setup. Used to pick the right email copy
  // (see sendEmail's isReturningOperator parameter) rather than telling a
  // returning operator to "set up" a password they already have.
  let isReturningOperator = false;

  const { data: authData, error: createUserError } =
    await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName },
    });

  if (!createUserError) {
    authUserId = authData.user.id;
    createdNewAuthUser = true;
  } else {
    // Handle idempotent retry: if auth user already exists, find their ID.
    const isDuplicate = createUserError.message?.toLowerCase().includes("already");
    if (!isDuplicate) {
      console.error(`${logTag} Auth user creation failed:`, createUserError.message);
      const report = reportOperationalError({
        error: new Error(createUserError.message),
        flow: OPERATOR_ACTIVATION_FLOW,
        stage: "auth-user-create",
        severity: "critical",
        context: { venueId, callerFlow: logTag },
      });
      await sendSlackAlert({
        channel:  "ops-critical",
        severity: "critical",
        title:    "Operator Provisioning Failed — Auth User Creation",
        message:  "Failed to create Supabase Auth user.",
        metadata: {
          Email: email, "Venue ID": venueId, Error: createUserError.message, Flow: logTag,
          "HHC Error": report.hhcErrorId, "Sentry Event": report.sentryEventId ?? "unavailable",
        },
      });
      return {
        ok: false,
        error: report.customerMessage,
        hhcErrorId: report.hhcErrorId,
      };
    }

    const { data: existingOp } = await supabase
      .from("operators")
      .select("id, account_activated_at")
      .eq("email", email)
      .maybeSingle();

    if (!existingOp?.id) {
      console.error(
        `${logTag} Auth user exists but no operator row found.`,
        { email }
      );
      const report = reportOperationalError({
        error: new Error("Auth user exists but no operator row found"),
        flow: OPERATOR_ACTIVATION_FLOW,
        stage: "auth-user-lookup",
        severity: "critical",
        context: { venueId, callerFlow: logTag },
      });
      await sendSlackAlert({
        channel:  "ops-critical",
        severity: "critical",
        title:    "Operator Provisioning Failed — Inconsistent Auth State",
        message:  "Auth user exists but no operator row found. Manual investigation required.",
        metadata: {
          Email: email, "Venue ID": venueId, Flow: logTag,
          "HHC Error": report.hhcErrorId, "Sentry Event": report.sentryEventId ?? "unavailable",
        },
      });
      return {
        ok: false,
        error: report.customerMessage,
        hhcErrorId: report.hhcErrorId,
      };
    }

    authUserId = existingOp.id as string;
    isReturningOperator = !!existingOp.account_activated_at;
    console.warn(`${logTag} Auth user already existed — reusing.`, { authUserId, isReturningOperator });
  }

  // ── Step 2: Insert operator row ───────────────────────────────────────────

  let createdNewOperator = false;

  const { error: operatorError } = await supabase.from("operators").insert({
    id:         authUserId,
    email,
    first_name: firstName || null,
    last_name:  lastName  || null,
    name:       fullName,
  });

  if (!operatorError) {
    createdNewOperator = true;
  } else if (operatorError.code !== "23505") {
    // 23505 = unique_violation → operator row already exists from a prior run; skip.
    console.error(`${logTag} Operator insert failed:`, operatorError.message);
    const report = reportOperationalError({
      error: new Error(operatorError.message),
      flow: OPERATOR_ACTIVATION_FLOW,
      stage: "operator-insert",
      severity: "critical",
      context: { venueId, authUserId, callerFlow: logTag },
    });
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "Operator Provisioning Failed — Operator Insert",
      message:  "Failed to insert operator row.",
      metadata: {
        Email: email, "Venue ID": venueId, Error: operatorError.message, Flow: logTag,
        "HHC Error": report.hhcErrorId, "Sentry Event": report.sentryEventId ?? "unavailable",
      },
    });
    if (createdNewAuthUser) await rbAuthUser(authUserId, "operator insert failed");
    return { ok: false, error: report.customerMessage, hhcErrorId: report.hhcErrorId };
  }

  // ── Step 3: Link venue to operator ────────────────────────────────────────
  // Does not touch any other venue this operator already owns — an operator
  // may legitimately own multiple venues (Phase 1 multi-venue support).

  const now = new Date().toISOString();

  const { error: venueError } = await supabase
    .from("venues")
    .update({
      claimed_by:             authUserId,
      claimed_at:             now,
      created_by_operator_id: authUserId,
      is_verified:            true,
    })
    .eq("id", venueId);

  if (venueError) {
    console.error(
      `${logTag} Venue link failed — rolling back:`,
      { venueId, authUserId, error: venueError.message }
    );
    const report = reportOperationalError({
      error: new Error(venueError.message),
      flow: OPERATOR_ACTIVATION_FLOW,
      stage: "venue-link",
      severity: "critical",
      context: { venueId, authUserId, callerFlow: logTag },
    });
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "Operator Provisioning Failed — Venue Link",
      message:  "Failed to link venue to operator. Rolling back.",
      metadata: {
        Email: email, "Venue ID": venueId, Error: venueError.message, Flow: logTag,
        "HHC Error": report.hhcErrorId, "Sentry Event": report.sentryEventId ?? "unavailable",
      },
    });
    if (createdNewOperator) await rbOperator(authUserId, "venue link failed");
    if (createdNewAuthUser) await rbAuthUser(authUserId, "venue link failed");
    return { ok: false, error: report.customerMessage, hhcErrorId: report.hhcErrorId };
  }

  // ── Step 4: Resolve the link to send ──────────────────────────────────────
  //
  // A returning operator (isReturningOperator) already has a password and an
  // authenticated way in — they don't need a Supabase recovery token at all.
  // Sending one anyway would land them on /operator/create-password, which
  // unconditionally shows a "set/reset your password" form regardless of
  // context (see that page's own header comment) — misleading for someone
  // who isn't setting up or recovering anything, and an unnecessary live
  // recovery token generated for no reason. A plain link to /login is both
  // simpler and correct here: sendVenueAddedToAccountEmail's copy already
  // says "sign in" / "Access my venues", which is exactly what this delivers.
  //
  // New operators (first venue, no password yet) still need the real
  // Supabase recovery link — it's the only way they get an authenticated
  // session and reach /operator/create-password to set a password at all.

  const appUrl = getSiteUrl();
  let actionLink: string;

  if (isReturningOperator) {
    actionLink = `${appUrl}/login`;
  } else {
    const redirectTo = `${appUrl}/operator/create-password`;

    // Retry only the known transient Supabase JWT/kid failure (see note at
    // top of file), up to 3 attempts total, short exponential backoff. Any
    // other error returns immediately on the first attempt.
    let linkData: Awaited<ReturnType<typeof supabase.auth.admin.generateLink>>["data"] | null = null;
    let linkError: Awaited<ReturnType<typeof supabase.auth.admin.generateLink>>["error"] = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await supabase.auth.admin.generateLink({
        type:    "recovery",
        email,
        options: { redirectTo },
      });
      linkData = result.data;
      linkError = result.error;

      if (!linkError || !isKnownSupabaseJwtKidError(linkError.message)) break;
      if (attempt < 3) {
        console.error(`${logTag} generateLink hit known Supabase JWT/kid issue — retrying (attempt ${attempt + 1}/3).`);
        await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 250 : 500));
      }
    }

    if (linkError || !linkData?.properties?.action_link) {
      console.error(
        `${logTag} generateLink failed — rolling back:`,
        { email, error: linkError?.message }
      );
      const report = reportOperationalError({
        error: new Error(linkError?.message ?? "generateLink returned no action_link"),
        flow: OPERATOR_ACTIVATION_FLOW,
        stage: "activation-link-generate",
        severity: "critical",
        context: { venueId, authUserId, callerFlow: logTag },
      });
      await sendSlackAlert({
        channel:  "ops-critical",
        severity: "critical",
        title:    "Operator Provisioning Failed — Setup Link Generation",
        message:  "Failed to generate Supabase recovery link. Rolling back.",
        metadata: {
          Email: email, "Venue ID": venueId, Error: linkError?.message ?? "unknown", Flow: logTag,
          "HHC Error": report.hhcErrorId, "Sentry Event": report.sentryEventId ?? "unavailable",
        },
      });
      await rbVenueLink(venueId, "generateLink failed");
      if (createdNewOperator) await rbOperator(authUserId, "generateLink failed");
      if (createdNewAuthUser) await rbAuthUser(authUserId, "generateLink failed");
      return { ok: false, error: report.customerMessage, hhcErrorId: report.hhcErrorId };
    }

    actionLink = linkData.properties.action_link;
  }

  // ── Step 5: Send activation email ────────────────────────────────────────

  const emailResult = await sendEmail(actionLink, isReturningOperator);

  if (!emailResult.ok) {
    // Sentry-only here (no reportCriticalFailure/new Slack alert): the
    // Slack escalation already fires from inside sendTransactionalEmail's
    // own criticality-based routing (operator_activation / claim_approval
    // → critical → #ops-critical, src/lib/email.ts's escalateEmailFailure)
    // — a call this function has no access to enrich, since it happens
    // deep inside the shared email subsystem behind the sendEmail()
    // callback. Adding a second Slack alert here would duplicate it.
    // Reporting to Sentry only still gives this specific occurrence its own
    // searchable HHC reference, even though the existing Slack alert for it
    // can't be enriched in this task — see the task report's "activation
    // email alert treatment" section for why extending escalateEmailFailure
    // itself is left as a follow-up rather than done here.
    const report = reportOperationalError({
      error: new Error(emailResult.error ?? "activation email send failed"),
      flow: OPERATOR_ACTIVATION_FLOW,
      stage: "activation-email",
      severity: "critical",
      context: { venueId, authUserId, callerFlow: logTag },
    });
    console.error(
      `${logTag} Activation email failed — rolling back.`,
      { error: emailResult.error, hhcErrorId: report.hhcErrorId }
    );
    await rbVenueLink(venueId, "email send failed");
    if (createdNewOperator) await rbOperator(authUserId, "email send failed");
    if (createdNewAuthUser) await rbAuthUser(authUserId, "email send failed");
    return { ok: false, error: report.customerMessage, hhcErrorId: report.hhcErrorId };
  }

  console.log(`${logTag} Operator provisioning complete.`, { authUserId, venueId });
  await sendSlackAlert({
    channel:  "ops-alerts",
    severity: "success",
    title:    "Operator Provisioned",
    message:  "Operator account created, venue linked, and activation email sent.",
    metadata: { Email: email, "Venue ID": venueId, "Auth User": authUserId, Flow: logTag },
  });
  return { ok: true, authUserId };
}

/**
 * Shared account-completion boundary — called once an operator has
 * successfully set their password on /operator/create-password, regardless
 * of whether the account originated from a claim approval, an auto-confirmed
 * Add Your Venue submission, or a manually approved Add Your Venue submission.
 *
 * That page is also reused for self-service password resets (see
 * /forgot-password), so this function gates on operators.account_activated_at
 * (migration 067) rather than firing on every password update:
 *
 *   UPDATE operators SET account_activated_at = now()
 *   WHERE id = $1 AND account_activated_at IS NULL
 *
 * The atomic WHERE clause means only the first successful call for a given
 * operator ever proceeds past it — concurrent retries and later password
 * resets are all safe no-ops. Never throws; failures are logged (and, where
 * the failure means the notification is now unrecoverable, escalated to
 * #ops-critical) since this must never block the operator's own
 * account-setup flow.
 *
 * Trade-off: the row is claimed (account_activated_at set) *before*
 * notification delivery is attempted, not after. This keeps the idempotency
 * gate a single atomic statement — the same duplicate-prevention guarantee
 * the rest of this file relies on — rather than a check-then-act pair that
 * would let a genuine concurrent retry send the notification twice. The cost
 * is that a delivery failure *after* the gate fires cannot be automatically
 * retried; that gap is covered by the critical Slack alerts below rather
 * than by weakening the gate or adding a queue/outbox.
 */
export async function completeOperatorAccountActivation({
  operatorId,
}: {
  operatorId: string;
}): Promise<void> {
  const supabase = createAdminClient();

  const { data: activatedRow, error: updateError } = await supabase
    .from("operators")
    .update({ account_activated_at: new Date().toISOString() })
    .eq("id", operatorId)
    .is("account_activated_at", null)
    .select("id, email, first_name, last_name, name")
    .maybeSingle();

  if (updateError) {
    console.error(
      "[completeOperatorAccountActivation] Update error:",
      updateError.message
    );
    // Covers both a genuine DB error and migration 067 not yet being applied
    // (missing column) — either way, no activation was recorded and no
    // notification was sent, so this must be loud rather than log-only.
    const report = reportOperationalError({
      error: new Error(updateError.message),
      flow: OPERATOR_ACTIVATION_FLOW,
      stage: "activation-complete-update",
      severity: "critical",
      context: { operatorId },
    });
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "Operator Account Activation — DB Update Failed",
      message:  "An operator completed account setup, but recording the activation failed (e.g. migration 067 not applied, or a DB error). No internal notification was sent for this activation. The operator's own account setup was not affected.",
      metadata: {
        "Operator ID": operatorId, Error: updateError.message,
        "HHC Error": report.hhcErrorId, "Sentry Event": report.sentryEventId ?? "unavailable",
      },
    });
    return;
  }

  if (!activatedRow) {
    // Already activated (retry, race, or a later password reset) — no-op.
    return;
  }

  const operatorEmail = activatedRow.email as string;
  const operatorName =
    (activatedRow.name as string | null) ||
    [activatedRow.first_name as string | null, activatedRow.last_name as string | null]
      .filter(Boolean)
      .join(" ") ||
    operatorEmail;

  // Best-effort venue + source-flow context — never blocks the notification.
  let venueId: string | null = null;
  let venueName: string | null = null;
  let sourceFlow = "Unknown";
  // Which entity's own lifecycle note trail this activation belongs to —
  // resolved from the same lookups as sourceFlow, reused below to write the
  // note into the correct table rather than a parallel history mechanism.
  let claimId: string | null = null;
  let submissionId: string | null = null;

  try {
    const { data: venueRow } = await supabase
      .from("venues")
      .select("id, name")
      .eq("claimed_by", operatorId)
      .maybeSingle();

    if (venueRow) {
      venueId = venueRow.id as string;
      venueName = venueRow.name as string;

      const { data: claimRow } = await supabase
        .from("venue_claims")
        .select("id")
        .eq("venue_id", venueId)
        .eq("status", "approved")
        .maybeSingle();

      if (claimRow) {
        sourceFlow = "Claim Your Venue";
        claimId = claimRow.id as string;
      } else {
        const { data: submissionRow } = await supabase
          .from("operator_submissions")
          .select("id, status")
          .eq("operator_id", operatorId)
          .maybeSingle();

        if (submissionRow) {
          submissionId = submissionRow.id as string;
          sourceFlow =
            (submissionRow.status as string) === "confirmed_auto"
              ? "Add Your Venue (auto-confirmed)"
              : "Add Your Venue (manual review)";
        }
      }
    }
  } catch (err) {
    console.error("[completeOperatorAccountActivation] Context lookup failed:", err);
  }

  console.log("[completeOperatorAccountActivation] First-time activation.", {
    operatorId,
    venueId,
    sourceFlow,
  });

  // ── Lifecycle note — reuses the same claim/submission notes tables and
  // system-note convention (created_by/created_by_email left null) already
  // used elsewhere, rather than a second activation-history mechanism.
  // Written regardless of email/Slack outcome below — the event itself
  // (the operator can now sign in) is true independent of notification
  // delivery. Skipped when neither a claim nor a submission was found —
  // nothing to attach it to, and this must not invent a source.
  const activationNote = `Operator account setup completed — ${operatorName} (${operatorEmail}) can now sign in to Operator Admin.`;
  let noteError: string | null = null;
  try {
    if (claimId) {
      const { error } = await supabase.from("venue_claim_notes").insert({
        claim_id:         claimId,
        note:             activationNote,
        created_by:       null,
        created_by_email: null,
      });
      if (error) noteError = error.message;
    } else if (submissionId) {
      const { error } = await supabase.from("operator_submission_notes").insert({
        submission_id:    submissionId,
        note:             activationNote,
        created_by:       null,
        created_by_email: null,
      });
      if (error) noteError = error.message;
    }
  } catch (err) {
    noteError = err instanceof Error ? err.message : String(err);
  }

  if (noteError) {
    console.error(
      "[completeOperatorAccountActivation] Note insert failed.",
      { operatorId, claimId, submissionId, error: noteError }
    );
    // account_activated_at is already committed above (the idempotency gate
    // has fired), so — exactly like the email-failure case below — this note
    // can never be automatically retried. Reuses the same ops-critical
    // pattern already established in this file rather than a queue/outbox:
    // a specific, context-rich alert for a human to add the note manually.
    const report = reportOperationalError({
      error: new Error(noteError),
      flow: OPERATOR_ACTIVATION_FLOW,
      stage: "activation-note",
      severity: "critical",
      context: { operatorId, venueId, claimId, submissionId },
    });
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "Operator Account Activated — Lifecycle Note Failed",
      message:  "An operator completed account setup, but the internal lifecycle note could not be recorded on the linked claim/submission. This will not be retried automatically — the activation is already recorded. Manual follow-up (adding the note by hand) may be needed.",
      metadata: {
        Operator:        operatorName,
        Email:           operatorEmail,
        Venue:           venueName ?? "Unknown",
        Source:          sourceFlow,
        "Operator ID":   operatorId,
        "Claim ID":      claimId ?? "n/a",
        "Submission ID": submissionId ?? "n/a",
        Error:           noteError,
        "HHC Error":     report.hhcErrorId,
        "Sentry Event":  report.sentryEventId ?? "unavailable",
      },
    });
  }

  const emailResult = await sendOperatorAccountActivatedNotificationEmail({
    operatorEmail,
    operatorName,
    venueId,
    venueName,
    sourceFlow,
  });

  if (!emailResult.ok) {
    console.error(
      "[completeOperatorAccountActivation] Notification email failed.",
      { operatorId, error: emailResult.error }
    );
    // account_activated_at is already committed above (the idempotency gate
    // has fired), so this is the only remaining signal that the notification
    // did not reach anyone — there is no automatic retry path once the gate
    // has fired. Mirrors the existing "committed but downstream step failed"
    // pattern used elsewhere in this file (see rbAuthUser/rbOperator/
    // rbVenueLink and reviewClaimAction's post-provisioning claim-update
    // failure): a specific, context-rich critical alert for manual follow-up,
    // richer than the generic escalateEmailFailure path (which only knows
    // type/to/error, not which operator or venue this was). This IS the sole
    // alert for this failure — sendOperatorAccountActivatedNotificationEmail
    // uses criticality "standard" (console-only inside sendTransactionalEmail),
    // so there is no separate alert to avoid duplicating here.
    const report = reportOperationalError({
      error: new Error(emailResult.error ?? "notification email send failed"),
      flow: OPERATOR_ACTIVATION_FLOW,
      stage: "activation-notification-email",
      severity: "critical",
      context: { operatorId, venueId },
    });
    await sendSlackAlert({
      channel:  "ops-critical",
      severity: "critical",
      title:    "Operator Account Activated — Notification Email Failed",
      message:  "An operator completed account setup, but the internal notification email failed to send. This will not be retried automatically — the activation is already recorded. Manual follow-up may be needed.",
      metadata: {
        Operator:      operatorName,
        Email:         operatorEmail,
        Venue:         venueName ?? "Unknown",
        Source:        sourceFlow,
        "Operator ID": operatorId,
        Error:         emailResult.error ?? "unknown",
        "HHC Error":   report.hhcErrorId,
        "Sentry Event": report.sentryEventId ?? "unavailable",
      },
    });
  }

  const activationSlackResult = await sendSlackAlert({
    channel:  "ops-alerts",
    severity: "success",
    title:    "Operator Account Activated",
    message:  "An operator has completed account setup and can now sign in to Operator Admin.",
    metadata: {
      Operator:      operatorName,
      Email:         operatorEmail,
      Venue:         venueName ?? "Unknown",
      Source:        sourceFlow,
      "Operator ID": operatorId,
    },
  });

  // sendSlackAlert never throws, so a missing/misconfigured
  // SLACK_OPS_ALERTS_WEBHOOK_URL previously failed completely silently —
  // this makes that outcome visible in logs. Deliberately does NOT escalate
  // via another Slack call on failure (that would be a Slack alert about a
  // Slack failure) — logging is the ceiling here, matching the same
  // check-and-log pattern already applied to the #venue-claims and
  // #venue-submissions more-info notifications.
  if (activationSlackResult !== "delivered") {
    console.error(
      "[completeOperatorAccountActivation] Slack notification not delivered.",
      { operatorId, channel: "ops-alerts", result: activationSlackResult }
    );
  }
}
