"use server";

import { recordOperatorSignIn } from "@/lib/operatorLogin/recordOperatorSignInImpl";
import { createOperatorSignInDeps } from "@/lib/operatorLogin/operatorLoginStore";

/**
 * Called by the Business Login form only after signInWithPassword() succeeded
 * and Business access was granted. Takes no arguments: operator, venues and
 * the sign-in itself are all derived from the verified session on the
 * server (see recordOperatorSignInImpl.ts). Returns nothing and never
 * throws — login notifications must never affect the sign-in.
 */
export async function recordOperatorSignInAction(): Promise<void> {
  try {
    await recordOperatorSignIn(createOperatorSignInDeps());
  } catch (err) {
    console.error("[recordOperatorSignInAction]", err instanceof Error ? err.message : String(err));
  }
}
