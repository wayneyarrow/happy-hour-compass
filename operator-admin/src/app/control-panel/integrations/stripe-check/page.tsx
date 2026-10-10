/**
 * TEMPORARY — staging-only Stripe configuration diagnostic for Comp/Trial
 * Checkout QA. Remove this page, src/lib/stripeEnvironmentCheck.ts and
 * tests/unit/stripe/stripeEnvironmentCheck.test.ts before any production
 * promotion.
 *
 * Access: Control Panel layout (signed in + isControlPanelAdmin), re-checked
 * here, AND the staging-only gate (staging site URL + non-production Vercel
 * environment) — 404 everywhere else. Not linked from navigation.
 *
 * Output: enums/booleans plus the public webhook URL it looked for. Never
 * renders or logs a key, price ID, endpoint ID, env value or Stripe error
 * text. Stripe is only called (read-only GETs) when the key is test mode.
 */

import { notFound, redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isControlPanelAdmin } from "@/lib/controlPanelAuth";
import { getSiteUrl } from "@/lib/siteUrl";
import {
  checkStripeEnvironment,
  isStagingDiagnosticAllowed,
  StripeGetError,
  REQUIRED_WEBHOOK_EVENTS,
  type CheckStatus,
  type StripeEnvironmentReport,
} from "@/lib/stripeEnvironmentCheck";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const metadata = { title: "Stripe Check (temporary)", robots: { index: false, follow: false } };

const STRIPE_API = "https://api.stripe.com";

function stripeGet(secretKey: string) {
  return async (path: string): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetch(`${STRIPE_API}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${secretKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new StripeGetError(0);
    }
    // Body is read only on success; error bodies are discarded unread.
    if (!res.ok) throw new StripeGetError(res.status);
    return res.json();
  };
}

const STATUS_STYLE: Record<CheckStatus, string> = {
  pass:        "bg-green-100 text-green-700",
  fail:        "bg-red-100 text-red-700",
  unknown:     "bg-amber-100 text-amber-700",
  not_checked: "bg-gray-100 text-gray-600",
};

function Status({ status }: { status: CheckStatus }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[status]}`}>{status}</span>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm py-2 border-b border-gray-100 last:border-0">
      <dt className="text-gray-500 w-56 shrink-0">{label}</dt>
      <dd className="text-gray-900 flex flex-wrap items-center gap-2">{children}</dd>
    </div>
  );
}

export default async function StripeCheckPage() {
  noStore();

  // Staging-only — 404 on Production and anywhere the environment is unclear.
  if (!isStagingDiagnosticAllowed(getSiteUrl(), process.env.VERCEL_ENV)) notFound();

  // Defence in depth on top of the Control Panel layout's own gate.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !(await isControlPanelAdmin(user.email))) redirect("/control-panel-login");

  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const report: StripeEnvironmentReport = await checkStripeEnvironment({
    secretKey,
    proPriceId: process.env.STRIPE_PRO_PRICE_ID,
    premiumPriceId: process.env.STRIPE_PREMIUM_PRICE_ID,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    expectedWebhookUrl: `${getSiteUrl()}/api/webhooks/stripe`,
    get: stripeGet(secretKey),
  });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Stripe configuration check</h1>
      <p className="mt-1 text-sm text-gray-500">
        Temporary, staging-only diagnostic for Comp/Trial Checkout QA. Read-only: Stripe is queried only when the key is
        test mode. No credentials, IDs or Stripe error text are shown. Rendered fresh on every load.
      </p>

      <div className={`mt-5 rounded-xl border px-4 py-3 text-sm font-semibold ${report.readyForCheckoutQa ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
        {report.readyForCheckoutQa ? "Ready for Checkout QA — all checks passed in test mode." : "Not ready for Checkout QA — see checks below."}
      </div>

      <dl className="mt-5 bg-white rounded-xl border border-gray-200 shadow-resting px-5 py-2">
        <Row label="Stripe key mode"><strong>{report.mode}</strong></Row>
        <Row label="Webhook secret configured">{report.webhookSecretConfigured ? "yes" : "no"}</Row>
        <Row label="Pro price"><Status status={report.proPrice.status} /> <span className="text-gray-500">{report.proPrice.detail}</span></Row>
        <Row label="Premium price"><Status status={report.premiumPrice.status} /> <span className="text-gray-500">{report.premiumPrice.detail}</span></Row>
        <Row label="Webhook endpoint (same environment)">
          <Status status={report.webhook.status} /> <span className="text-gray-500">{report.webhook.detail}</span>
        </Row>
        <Row label="Expected endpoint URL"><code className="text-xs">{report.webhook.expectedUrl}</code></Row>
        {report.webhook.missingEvents.length > 0 && (
          <Row label="Missing webhook events"><span className="text-xs">{report.webhook.missingEvents.join(", ")}</span></Row>
        )}
      </dl>

      <p className="mt-3 text-xs text-gray-400">
        Webhook passes when an enabled endpoint at the expected URL subscribes to all of: {REQUIRED_WEBHOOK_EVENTS.join(", ")} — or to all events (*).
      </p>
    </div>
  );
}
