"use server";

import { createClient } from "@/lib/supabase/server";
import { hasConsumerProfile } from "@/lib/consumerAccess";
import { hasOperatorAccess } from "@/lib/operatorAccess";
import type { AccountAccess } from "@/lib/accessOutcome";

/**
 * Resolves Consumer/Business account access for the CURRENTLY authenticated
 * session (the caller must already have called supabase.auth.signInWithPassword
 * or otherwise established a session before invoking this).
 *
 * Called directly from Client Components (Consumer Login, Business Login,
 * and Consumer recovery completion) immediately after authentication
 * succeeds, to decide — via src/lib/accessOutcome.ts's pure resolver —
 * whether to grant access, show wrong-context messaging, or (recovery only)
 * offer a Business continuation. See CLAUDE.md's Authentication & Email
 * section: Consumer and Operator share one Auth identity store, so a
 * successful supabase-level authentication is never by itself sufficient to
 * grant either experience.
 */
export async function resolveCurrentUserAccess(): Promise<AccountAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { isConsumer: false, isOperator: false };
  }

  const [isConsumer, isOperator] = await Promise.all([
    hasConsumerProfile(user.id),
    hasOperatorAccess(user.email),
  ]);

  return { isConsumer, isOperator };
}
