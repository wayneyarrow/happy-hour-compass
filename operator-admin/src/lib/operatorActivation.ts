import { createAdminClient } from "@/lib/supabase/server";

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Provisions an operator account for a venue and sends an activation email.
 *
 * Steps (mirrors reviewClaimAction steps 2-6):
 *  1. Create Supabase Auth user (email_confirm: true, no password). If the
 *     user already exists, look up their ID from the operators table (retry).
 *  2. Insert operator row (id = auth user UUID). Idempotent on 23505 conflict.
 *  3. Unlink other venues from this operator (one-venue-per-operator invariant).
 *  4. Link venue: set claimed_by, claimed_at, created_by_operator_id.
 *  5. Generate Supabase recovery link pointing to /operator/create-password.
 *  6. Call sendEmail(setupLink) — rollback all prior steps on failure.
 *
 * Returns { ok: true, authUserId } on success.
 * Returns { ok: false, error } on any step failure after full rollback.
 *
 * The sendEmail callback decouples email copy from provisioning logic,
 * allowing claim approvals and operator submissions to use different copy
 * without diverging the core provisioning flow.
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
  sendEmail: (setupLink: string) => Promise<{ ok: boolean; error?: string }>;
}): Promise<{ ok: true; authUserId: string } | { ok: false; error: string }> {
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
    }
  }

  async function rbOperator(userId: string, context: string) {
    const { error } = await supabase.from("operators").delete().eq("id", userId);
    if (error) {
      console.error(
        `${logTag} CRITICAL: ${context} — operator rollback failed.`,
        { userId, rollbackError: error.message }
      );
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
    }
  }

  // ── Step 1: Create Supabase Auth user ────────────────────────────────────

  let authUserId: string;
  let createdNewAuthUser = false;

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
      return {
        ok: false,
        error: `Failed to create operator account: ${createUserError.message}`,
      };
    }

    const { data: existingOp } = await supabase
      .from("operators")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (!existingOp?.id) {
      console.error(
        `${logTag} Auth user exists but no operator row found.`,
        { email }
      );
      return {
        ok: false,
        error:
          "An account with this email already exists but could not be resolved. " +
          "Please contact support.",
      };
    }

    authUserId = existingOp.id as string;
    console.warn(`${logTag} Auth user already existed — reusing.`, { authUserId });
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
    if (createdNewAuthUser) await rbAuthUser(authUserId, "operator insert failed");
    return { ok: false, error: "Failed to create operator record. Please try again." };
  }

  // ── Step 3: One-venue-per-operator invariant ──────────────────────────────
  // Unlink any other venues currently owned by this operator before linking
  // the submission venue. This is a no-op for fresh operators with no prior venues.

  await supabase
    .from("venues")
    .update({ created_by_operator_id: null })
    .eq("created_by_operator_id", authUserId)
    .neq("id", venueId);

  // ── Step 4: Link venue to operator ────────────────────────────────────────

  const now = new Date().toISOString();

  const { error: venueError } = await supabase
    .from("venues")
    .update({
      claimed_by:             authUserId,
      claimed_at:             now,
      created_by_operator_id: authUserId,
    })
    .eq("id", venueId);

  if (venueError) {
    console.error(
      `${logTag} Venue link failed — rolling back:`,
      { venueId, authUserId, error: venueError.message }
    );
    if (createdNewOperator) await rbOperator(authUserId, "venue link failed");
    if (createdNewAuthUser) await rbAuthUser(authUserId, "venue link failed");
    return { ok: false, error: "Failed to link venue to operator account. Please try again." };
  }

  // ── Step 5: Generate Supabase recovery link ───────────────────────────────
  // Points directly to /operator/create-password. Supabase appends
  // #access_token=...&type=recovery to this URL so the page can call setSession().

  const appUrl = getAppUrl();
  const redirectTo = `${appUrl}/operator/create-password`;

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type:    "recovery",
    email,
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error(
      `${logTag} generateLink failed — rolling back:`,
      { email, error: linkError?.message }
    );
    await rbVenueLink(venueId, "generateLink failed");
    if (createdNewOperator) await rbOperator(authUserId, "generateLink failed");
    if (createdNewAuthUser) await rbAuthUser(authUserId, "generateLink failed");
    return { ok: false, error: "Failed to generate account setup link. Please try again." };
  }

  // ── Step 6: Send activation email ────────────────────────────────────────

  const emailResult = await sendEmail(linkData.properties.action_link);

  if (!emailResult.ok) {
    console.error(
      `${logTag} Activation email failed — rolling back.`,
      { error: emailResult.error }
    );
    await rbVenueLink(venueId, "email send failed");
    if (createdNewOperator) await rbOperator(authUserId, "email send failed");
    if (createdNewAuthUser) await rbAuthUser(authUserId, "email send failed");
    return {
      ok: false,
      error:
        "Activation email could not be sent. Please try again or contact support.",
    };
  }

  console.log(`${logTag} Operator provisioning complete.`, { authUserId, venueId });
  return { ok: true, authUserId };
}
