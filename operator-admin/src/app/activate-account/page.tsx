import Image from "next/image";
import { createAdminClient } from "@/lib/supabase/server";
import ActivateAccountForm from "./ActivateAccountForm";

// ── Error state ───────────────────────────────────────────────────────────────

function InvalidLinkPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Image
            src="/logo.png"
            alt="Happy Hour Compass"
            width={80}
            height={80}
            className="rounded-xl"
          />
        </div>
        <div className="bg-white p-8 rounded-xl shadow-md text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            Link unavailable
          </h1>
          <p className="text-sm text-gray-500 mb-5">
            This activation link is invalid or has expired. Activation links are
            valid for 7 days after your claim is approved.
          </p>
          <a
            href="/login"
            className="text-sm text-amber-600 hover:text-amber-700 font-medium"
          >
            Go to sign in
          </a>
        </div>
      </div>
    </main>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

/**
 * /activate-account?token=...
 *
 * Public route — no auth required. Validates the activation token from the
 * venue claim approval email, then renders the account creation form.
 *
 * Token validation:
 *   - Looks up venue_claims by activation_token.
 *   - Checks activation_expires_at > now() (7-day window).
 *   - Uses createAdminClient() to bypass RLS (claimants are not authenticated).
 *
 * On valid token: renders ActivateAccountForm with prefilled claim data.
 * On invalid/expired token: renders InvalidLinkPage.
 */
export default async function ActivateAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <InvalidLinkPage />;
  }

  const supabase = createAdminClient();

  const { data: claim, error } = await supabase
    .from("venue_claims")
    .select("id, venue_id, email, first_name, last_name, activation_expires_at")
    .eq("activation_token", token)
    .gt("activation_expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !claim) {
    return <InvalidLinkPage />;
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Image
            src="/logo.png"
            alt="Happy Hour Compass"
            width={80}
            height={80}
            className="rounded-xl"
          />
        </div>

        <div className="bg-white p-8 rounded-xl shadow-md">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">
              Create your account
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Your venue claim has been approved. Set a password to activate
              your operator account.
            </p>
          </div>

          <ActivateAccountForm
            token={token}
            email={claim.email as string}
            firstName={(claim.first_name as string) ?? ""}
            lastName={(claim.last_name as string) ?? ""}
          />
        </div>
      </div>
    </main>
  );
}
