export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations" };

import { SlackTestPanel } from "@/app/control-panel/settings/SlackTestPanel";

export default function ControlPanelIntegrationsPage() {
  // TEMPORARY — diagnosing a reported "no-webhook" result despite the
  // SLACK_OPS_ALERTS_WEBHOOK_URL var being confirmed present in the Vercel
  // dashboard. Read server-side, at request time, in this exact serverless
  // instance — booleans only, never the value itself. Remove once resolved.
  const envDiagnostic = {
    nodeEnv:               process.env.NODE_ENV ?? "unknown",
    vercelEnv:             process.env.VERCEL_ENV ?? "unknown",
    opsAlertsConfigured:   Boolean(process.env.SLACK_OPS_ALERTS_WEBHOOK_URL),
    opsCriticalConfigured: Boolean(process.env.SLACK_OPS_CRITICAL_WEBHOOK_URL),
  };

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Integrations</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage third-party service connections and test notification delivery.
        </p>
      </div>

      <div className="space-y-6">

        {/* ── Slack ─────────────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
            Slack
          </h2>
          <SlackTestPanel envDiagnostic={envDiagnostic} />
        </div>

        {/* ── Coming soon ───────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm text-gray-400">
            Additional integrations will be added here over time.
          </p>
          <ul className="mt-3 space-y-1.5">
            {["Stripe", "Email", "RSS Sources", "Push Notifications"].map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-gray-300">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-200 shrink-0" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>

      </div>
    </div>
  );
}
