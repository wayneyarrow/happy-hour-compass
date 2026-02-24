import type { SupabaseClient, User } from "@supabase/supabase-js";

/** Shape of a row from the `operators` table (selected fields). */
export type OperatorRow = {
  id: string;
  email: string;
  name: string | null;
  is_approved: boolean;
  role: string;
  created_at: string;
  updated_at: string;
};

const OPERATOR_SELECT = "id, email, name, is_approved, role, created_at, updated_at";

/**
 * Ensures an `operators` row exists for the current authenticated user.
 *
 * Idempotent — safe to call on every page load / session check, including
 * React Strict Mode double-invocations and concurrent requests.
 *
 * Strategy:
 *   1. SELECT by email using maybeSingle().
 *      • maybeSingle() returns { data: null, error: null } when 0 rows match —
 *        it never raises a PGRST116 "no rows" error, so any fetchError here
 *        is a genuine database/RLS problem worth surfacing.
 *   2. If a row is found → return it immediately. No write.
 *   3. If no row found → INSERT { email }.
 *   4. If the INSERT fails with Postgres error 23505 (unique_violation on
 *      operators_email_key), the row was created between our SELECT and INSERT
 *      (race condition or double-render). Recover with one final SELECT.
 *      Only surface an error if that follow-up SELECT also fails.
 *
 * Does NOT use the service-role/admin client — all operations run through
 * the authenticated session client and respect RLS.
 *
 * @param supabase  The server-side Supabase client (has the user's session).
 * @param user      The Supabase Auth user object from supabase.auth.getUser().
 * @returns         { operator, error } — operator is null only on failure.
 */
export async function ensureOperatorForSession(
  supabase: SupabaseClient,
  user: User
): Promise<{ operator: OperatorRow | null; error: string | null }> {
  const email = user.email;

  if (!email) {
    return { operator: null, error: "Auth user has no email address." };
  }

  // ── Step 1: Fetch existing row ────────────────────────────────────────────
  const { data: existing, error: fetchError } = await supabase
    .from("operators")
    .select(OPERATOR_SELECT)
    .eq("email", email)
    .maybeSingle();

  // maybeSingle() never errors on "0 rows" — any error here is real.
  if (fetchError) {
    console.error("[ensureOperator] SELECT failed:", fetchError);
    return {
      operator: null,
      error: `Failed to fetch operator record: ${fetchError.message}`,
    };
  }

  if (existing) {
    // Row already exists — return it without any write.
    return { operator: existing as OperatorRow, error: null };
  }

  // ── Step 2: Insert a new row ──────────────────────────────────────────────
  // Only `email` is required; all other columns use Postgres defaults:
  //   name → null, is_approved → false, role → 'operator',
  //   created_at / updated_at → NOW()
  const { data: inserted, error: insertError } = await supabase
    .from("operators")
    .insert({ email })
    .select(OPERATOR_SELECT)
    .single();

  if (!insertError) {
    return { operator: inserted as OperatorRow, error: null };
  }

  // ── Step 3: Handle unique-violation race ─────────────────────────────────
  // Postgres error 23505 = unique_violation.
  // This means the row was created between our SELECT (returned nothing) and
  // our INSERT (duplicate key). Recover by fetching the now-existing row.
  if (insertError.code === "23505") {
    console.warn(
      "[ensureOperator] INSERT hit unique conflict on operators_email_key — " +
        "falling back to SELECT (likely a race condition or double-render)."
    );

    const { data: recovered, error: recoveryError } = await supabase
      .from("operators")
      .select(OPERATOR_SELECT)
      .eq("email", email)
      .maybeSingle();

    if (recoveryError) {
      console.error("[ensureOperator] Recovery SELECT failed:", recoveryError);
      return {
        operator: null,
        error: `Operator row exists but could not be read after conflict: ${recoveryError.message}`,
      };
    }

    if (recovered) {
      return { operator: recovered as OperatorRow, error: null };
    }

    // Row exists (unique constraint fired) but SELECT returned nothing —
    // most likely an RLS policy mismatch. Surface a clear message.
    return {
      operator: null,
      error:
        "Operator row exists but could not be retrieved — check RLS policies.",
    };
  }

  // Any other INSERT error is unexpected; surface it as-is.
  console.error("[ensureOperator] INSERT failed:", insertError);
  return {
    operator: null,
    error: `Failed to create operator record: ${insertError.message}`,
  };
}
