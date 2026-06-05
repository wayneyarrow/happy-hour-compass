import Image from "next/image";
import { createAdminClient } from "@/lib/supabase/server";
import { getMembershipByToken } from "@/lib/memberships";
import InviteAcceptForm from "./InviteAcceptForm";

// ── Error state ───────────────────────────────────────────────────────────────

function InvalidInvitePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Image src="/logo.png" alt="Happy Hour Compass" width={80} height={80} className="rounded-xl" />
        </div>
        <div className="bg-white p-8 rounded-xl shadow-md text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invitation unavailable</h1>
          <p className="text-sm text-gray-500">
            This invitation link has expired, already been used, or has been cancelled.
            Please contact the venue owner to request a new invitation.
          </p>
        </div>
      </div>
    </main>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

/**
 * /operator/invite/[token]
 *
 * Public route — no auth required. Validates the invite token from the
 * member invitation email, then renders the account creation form.
 *
 * Token validation:
 *   - Looks up operator_memberships by invite_token.
 *   - Checks status = 'invited' (not accepted or cancelled).
 *
 * On valid token: renders InviteAcceptForm with prefilled email/name.
 * On invalid token: renders InvalidInvitePage.
 */
export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!token) return <InvalidInvitePage />;

  const membership = await getMembershipByToken(token);
  if (!membership) return <InvalidInvitePage />;

  // Fetch venue name for the welcome message
  const supabase = createAdminClient();
  const { data: venueData } = await supabase
    .from("venues")
    .select("name")
    .eq("created_by_operator_id", membership.operator_id)
    .maybeSingle();
  const venueName = (venueData as { name?: string } | null)?.name ?? null;

  // Parse name parts from full_name if provided
  const nameParts   = membership.full_name?.trim().split(/\s+/) ?? [];
  const firstName   = nameParts[0] ?? "";
  const lastName    = nameParts.slice(1).join(" ");

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Image src="/logo.png" alt="Happy Hour Compass" width={80} height={80} className="rounded-xl" />
        </div>

        <div className="bg-white p-8 rounded-xl shadow-md">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">
              Accept your invitation
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {venueName
                ? <>You&rsquo;ve been invited to help manage <strong>{venueName}</strong> on Happy Hour Compass.</>
                : <>You&rsquo;ve been invited to help manage a venue on Happy Hour Compass.</>}
              {" "}Set a password to activate your account.
            </p>
          </div>

          <InviteAcceptForm
            token={token}
            email={membership.email}
            firstName={firstName}
            lastName={lastName}
          />
        </div>
      </div>
    </main>
  );
}
