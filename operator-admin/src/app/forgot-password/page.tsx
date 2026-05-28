import Image from "next/image";
import ForgotPasswordForm from "./ForgotPasswordForm";

export const metadata = { title: "Reset Password — Happy Hour Compass" };

/**
 * /forgot-password
 *
 * Public route — no auth required.
 *
 * ?info=link-expired — passed from /auth/callback on PKCE exchange failure
 * and from expired-link states in /activate-account and /operator/create-password.
 * Surfaces a contextual message above the form.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ info?: string }>;
}) {
  const { info } = await searchParams;
  const showLinkExpiredMessage = info === "link-expired";

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

        <div className="bg-white p-8 rounded-xl shadow-md">
          <ForgotPasswordForm showLinkExpiredMessage={showLinkExpiredMessage} />
        </div>
      </div>
    </main>
  );
}
