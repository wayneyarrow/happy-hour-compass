import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { setupContactKindForEmail } from "@/lib/activation/setupContactPolicy";
import { recordSetupContactForRecipient } from "@/lib/activation/setupContactStore";

/**
 * Called by sendTransactionalEmail() immediately BEFORE the provider call
 * for every outgoing email. When the email is a setup contact
 * (setupContactKindForEmail) and the recipient is an unactivated operator,
 * stamps public.operators.last_setup_contact_at (migration 104).
 *
 * Recording before the provider call is deliberately conservative:
 *   - provider accepts      → evidence correct;
 *   - ambiguous timeout     → evidence present (the email may have gone);
 *   - definite failure      → evidence present anyway — this can only delay
 *     a later milestone by up to 48 h, never cause two emails close together.
 *
 * Operator-requested emails (verification codes, recovery/setup requests)
 * are recorded the same way and are never delayed by this. Bounded (2 s)
 * and never throws: an evidence write must never block or fail a send. When
 * Supabase credentials are absent (unit tests, local scripts) it is a no-op.
 */

const EVIDENCE_TIMEOUT_MS = 2000;

export type SetupContactEvidenceDeps = {
  admin?: SupabaseClient;
  now?: () => Date;
  timeoutMs?: number;
};

export async function recordSetupContactBeforeSend(
  params: { emailType: string; to: string; trigger?: string | null },
  deps: SetupContactEvidenceDeps = {}
): Promise<"recorded" | "skipped"> {
  const kind = setupContactKindForEmail(params.emailType, params.trigger);
  if (!kind) return "skipped";
  if (!deps.admin && !(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY)) return "skipped";
  try {
    const admin = deps.admin ?? createAdminClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), deps.timeoutMs ?? EVIDENCE_TIMEOUT_MS);
    });
    const outcome = await Promise.race([
      recordSetupContactForRecipient(admin, { recipientEmail: params.to, kind, at: (deps.now ?? (() => new Date()))() }),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    if (outcome === "timeout") console.warn("[setupContactEvidence] Evidence write timed out; sending anyway.", { emailType: params.emailType });
    return outcome === "written" ? "recorded" : "skipped";
  } catch (err) {
    console.warn("[setupContactEvidence] Evidence write failed; sending anyway.", { emailType: params.emailType, error: err instanceof Error ? err.message : String(err) });
    return "skipped";
  }
}
