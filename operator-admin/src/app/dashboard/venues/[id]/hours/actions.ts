"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  IMP_COOKIE_NAME,
  getValidImpersonationSession,
  resolveOperatorContext,
} from "@/lib/impersonation";
import { hasOperatorAccess } from "@/lib/operatorAccess";
import { shouldBlockAdminAccess } from "@/lib/accessOutcome";
import { DAYS_OF_WEEK, TIME_24H_RE } from "../../_shared/hoursUtils";
import type {
  BusinessHours,
  BusinessHoursFormState,
  DayOfWeek,
} from "../../_shared/types";

const DEFAULT_OPEN = "09:00";
const DEFAULT_CLOSE = "22:00";

/** Returns the submitted value only when it's a well-formed 24-hour "HH:MM" string, else the given default — defensive against a malformed/non-browser submission, since a native <input type="time"> always posts this shape on a normal submit. */
function readTime(formData: FormData, name: string, fallback: string): string {
  const raw = formData.get(name) as string | null;
  return raw && TIME_24H_RE.test(raw) ? raw : fallback;
}

export type UpdateBusinessHoursState = BusinessHoursFormState;

/**
 * Server action to update a venue's business_hours JSONB column.
 *
 * `venueId` is bound via `.bind(null, venueId)` in the client component —
 * it is never read from FormData.
 *
 * Impersonation-aware: delegates operator resolution to resolveOperatorContext(),
 * which returns the admin client + impersonated operator when a valid
 * imp_session_id cookie is present.
 */
export async function updateBusinessHoursAction(
  venueId: string,
  _prevState: UpdateBusinessHoursState,
  formData: FormData
): Promise<UpdateBusinessHoursState> {
  // ── Parse & validate each day ─────────────────────────────────────────────
  const hours: BusinessHours = {};
  const errors: Partial<Record<DayOfWeek | "form", string>> = {};

  for (const day of DAYS_OF_WEEK) {
    const closed = formData.get(`${day}_closed`) === "on";

    if (closed) {
      hours[day] = null;
      continue;
    }

    const open  = readTime(formData, `${day}_open`,  DEFAULT_OPEN);
    const close = readTime(formData, `${day}_close`, DEFAULT_CLOSE);

    if (open === close) {
      errors[day] = "Opening and closing times cannot be the same.";
      hours[day] = { open, close };
      continue;
    }

    hours[day] = { open, close };
  }

  if (Object.keys(errors).length > 0) {
    return { errors, hours };
  }

  // ── Business-access gate — before resolveOperatorContext() ─────────────────
  // resolveOperatorContext()'s non-impersonating fallback is
  // ensureOperatorForSession(), which auto-provisions an `operators` row for
  // any authenticated identity with none — it must never be reached by a
  // Consumer-only (or otherwise non-Operator) identity just because this
  // action was invoked. Checked independently of impersonation status,
  // exactly like admin/layout.tsx: a Founder/CP-admin's own identity is
  // never expected to have Business access itself, so impersonating callers
  // are exempt from this check (their authorization is the session cookie).
  const cookieStore = await cookies();
  const impSessionId = cookieStore.get(IMP_COOKIE_NAME)?.value;
  const impSession = impSessionId ? await getValidImpersonationSession(impSessionId) : null;

  if (!impSession) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isOperator = !!user?.email && (await hasOperatorAccess(user.email));
    if (shouldBlockAdminAccess({ isImpersonating: false, hasOperatorAccess: isOperator })) {
      return {
        errors: { form: "This account doesn't have Business/Operator access." },
        hours,
      };
    }
  }

  // ── Resolve operator context (impersonation-aware) ─────────────────────────
  const ctx = await resolveOperatorContext();

  if (ctx.operatorError || (!ctx.operator && !ctx.isImpersonating)) {
    return {
      errors: {
        form: ctx.operatorError ?? "Could not resolve your operator account. Try refreshing the page.",
      },
      hours,
    };
  }

  // ── Update ─────────────────────────────────────────────────────────────────
  const updates = {
    business_hours: hours,
    ...(ctx.operator ? { updated_by_operator_id: ctx.operator.id } : {}),
  };

  let q = ctx.supabase
    .from("venues")
    .update(updates, { count: "exact" })
    .eq("id", venueId);

  if (ctx.operator) {
    q = q.eq("created_by_operator_id", ctx.operator.id);
  }

  const { error: updateError, count } = await q;

  if (updateError) {
    console.error("[updateBusinessHoursAction] Update failed:", updateError);
    return {
      errors: { form: `Failed to save hours: ${updateError.message}` },
      hours,
    };
  }

  if (count === 0) {
    return {
      errors: { form: "Venue not found or you don't have permission to edit it." },
      hours,
    };
  }

  return { success: true, hours };
}
