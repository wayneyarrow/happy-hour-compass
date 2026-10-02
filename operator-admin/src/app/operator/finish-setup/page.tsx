import Image from "next/image";
import ForgotPasswordForm from "@/app/forgot-password/ForgotPasswordForm";

export const metadata = {
  title: "Finish Setting Up Your Account",
  robots: { index: false, follow: false },
};

/**
 * /operator/finish-setup
 *
 * The durable, non-secret destination of the "Finish your setup" button in
 * incomplete-setup milestone emails. Opening this page never creates or
 * consumes a setup token: it only renders the request form. Submitting it
 * reuses forgotPasswordAction (Turnstile, non-enumerating response,
 * recovery gate) with intent=setup:
 *   - unactivated operator, legacy or window closed → a setup-worded email
 *     with a fresh scanner-safe link (replaces earlier setup links);
 *   - email-code lifecycle with its window still open → the existing
 *     continue-setup email (the code step stays required);
 *   - already-activated operator → the normal password-reset email;
 *   - unknown address → nothing, same response.
 * Public (middleware only guards /admin and /dashboard).
 */
export default function FinishSetupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Image src="/logo.png" alt="Happy Hour Compass" width={80} height={80} className="rounded-xl" />
        </div>
        <div className="bg-white p-8 rounded-xl shadow-md">
          <ForgotPasswordForm showLinkExpiredMessage={false} intent="setup" />
        </div>
      </div>
    </main>
  );
}
