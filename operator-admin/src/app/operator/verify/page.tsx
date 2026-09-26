import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { loadVerificationPageView } from "@/lib/activation/emailCodeVerificationService";
import { VERIFIED_BROWSER_PROOF_COOKIE } from "@/lib/activation/emailCodeVerificationTokens";
import VerifyEmailCodeScreen from "./VerifyEmailCodeScreen";

/**
 * /operator/verify?t=<signed link token>
 *
 * Email-code activation (Phase 2B). Reached from the in-flow Add Your
 * Venue redirect, or from an approval / reminder / founder-resend email
 * for a verification-required lifecycle. Loading this page is READ-ONLY:
 * it never issues or consumes a code, so a refresh, back/forward, or an
 * email scanner prefetching the link can't send an email or burn a code.
 *
 * After a successful code, the operator continues on the EXISTING
 * /operator/create-password page (its cookie-session path) — password
 * creation and activation are exactly the legacy steps.
 */

export const metadata: Metadata = {
  title: "Verify your email",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function OperatorVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const verifiedProof = (await cookies()).get(VERIFIED_BROWSER_PROOF_COOKIE)?.value ?? null;

  const view = await loadVerificationPageView(token, { sessionUserId: user?.id ?? null, verifiedProof });

  return <VerifyEmailCodeScreen token={token} initialView={view} />;
}
