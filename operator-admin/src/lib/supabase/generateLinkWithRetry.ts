import type { SupabaseClient } from "@supabase/supabase-js";

// KNOWN ISSUE: Supabase's GoTrue Admin API intermittently rejects calls with
// "unrecognized JWT kid <nil> for algorithm ES256" following the platform's
// HS256→ES256 JWT signing-key migration — a confirmed upstream bug, not a
// config/code issue (see supabase/supabase#48295, #48272). Same mitigation as
// provisionOperatorForVenue (src/lib/operatorActivation.ts, which keeps its
// own inline copy of this check) — remove both once Supabase ships a fix.
function isKnownSupabaseJwtKidError(message: string | null | undefined): boolean {
  return !!message && message.includes("unrecognized JWT kid") && message.includes("ES256");
}

type GenerateLinkResult = Awaited<ReturnType<SupabaseClient["auth"]["admin"]["generateLink"]>>;
type GenerateLinkParams = Parameters<SupabaseClient["auth"]["admin"]["generateLink"]>[0];

/**
 * Wraps supabase.auth.admin.generateLink() with a retry for the known
 * transient JWT/kid failure above — up to 3 attempts total, short
 * exponential backoff. Any other error returns immediately on the first
 * attempt; callers handle it exactly as they would an unwrapped call.
 */
export async function generateLinkWithRetry(
  supabase: SupabaseClient,
  params: GenerateLinkParams
): Promise<GenerateLinkResult> {
  let result: GenerateLinkResult;

  for (let attempt = 1; attempt <= 3; attempt++) {
    result = await supabase.auth.admin.generateLink(params);

    if (!result.error || !isKnownSupabaseJwtKidError(result.error.message)) {
      return result;
    }
    if (attempt < 3) {
      console.error(`[generateLinkWithRetry] generateLink hit known Supabase JWT/kid issue — retrying (attempt ${attempt + 1}/3).`);
      await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 250 : 500));
    }
  }

  return result!;
}
