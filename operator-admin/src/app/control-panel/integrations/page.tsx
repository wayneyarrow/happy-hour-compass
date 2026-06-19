export const dynamic = "force-dynamic";
export const metadata = { title: "Integrations" };

import { SlackTestPanel } from "@/app/control-panel/settings/SlackTestPanel";

export default function ControlPanelIntegrationsPage() {
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
          <SlackTestPanel />
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
