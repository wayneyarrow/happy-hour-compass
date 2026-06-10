import Image from "next/image";
import { getPlatformAdminByToken } from "@/lib/platformAdmins";
import AcceptCpInviteForm from "./AcceptCpInviteForm";

// ── Error state ───────────────────────────────────────────────────────────────

function InvalidInvitePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Image src="/hhc-icon.png" alt="Happy Hour Compass" width={48} height={48} className="rounded-xl" />
        </div>
        <div className="bg-white p-8 rounded-xl shadow-md text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invitation unavailable</h1>
          <p className="text-sm text-gray-500">
            This invitation link has expired, already been used, or is invalid.
            Contact the person who invited you to request a new link.
          </p>
        </div>
      </div>
    </main>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

/**
 * /cp-invite/[token]
 *
 * Public route — lives OUTSIDE /control-panel/* so the CP layout (which
 * redirects non-admins) does not wrap it. Same pattern as /operator/invite/[token].
 *
 * Validates the invite token and renders the account-creation form.
 * On acceptance: Supabase auth user is created and platform_admins row is
 * set to 'active'.
 */
export default async function CpInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token) return <InvalidInvitePage />;

  const admin = await getPlatformAdminByToken(token);
  if (!admin) return <InvalidInvitePage />;

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Image src="/hhc-icon.png" alt="Happy Hour Compass" width={48} height={48} className="rounded-xl" />
        </div>

        <div className="bg-white p-8 rounded-xl shadow-md">
          <div className="mb-6">
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">
              Happy Hour Compass
            </p>
            <h1 className="text-2xl font-bold text-gray-900">
              Accept your invitation
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              You&rsquo;ve been invited to access the Admin Control Panel.
              Set a password to activate your account.
            </p>
          </div>

          <AcceptCpInviteForm token={token} email={admin.email} />
        </div>
      </div>
    </main>
  );
}
