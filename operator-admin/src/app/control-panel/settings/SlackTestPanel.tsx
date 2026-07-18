"use client";

import { useActionState } from "react";
import { slackTestAction, type SlackTestState } from "./actions";

const INITIAL_STATE: SlackTestState = {};

const ENV_VAR: Record<string, string> = {
  "ops-alerts":   "SLACK_OPS_ALERTS_WEBHOOK_URL",
  "ops-critical": "SLACK_OPS_CRITICAL_WEBHOOK_URL",
};

/** TEMPORARY diagnostic — remove once the "no-webhook" investigation is resolved. */
export type EnvDiagnostic = {
  nodeEnv: string;
  vercelEnv: string;
  opsAlertsConfigured: boolean;
  opsCriticalConfigured: boolean;
};

export function SlackTestPanel({ envDiagnostic }: { envDiagnostic?: EnvDiagnostic }) {
  const [state, formAction, pending] = useActionState(slackTestAction, INITIAL_STATE);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-slate-900 mb-1">
        Slack Notification Test
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Send a test notification to confirm webhook configuration and channel delivery.
        Webhook URLs are never shown here.
      </p>

      {/* TEMPORARY — server-side env diagnostic. No secret values, booleans only. */}
      {envDiagnostic && (
        <div className="mb-4 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-700 space-y-0.5">
          <p className="font-sans font-semibold text-slate-500 mb-1">
            Temporary diagnostic (this instance, this request)
          </p>
          <p>NODE_ENV: {envDiagnostic.nodeEnv}</p>
          <p>VERCEL_ENV: {envDiagnostic.vercelEnv}</p>
          <p>SLACK_OPS_ALERTS_WEBHOOK_URL defined: {String(envDiagnostic.opsAlertsConfigured)}</p>
          <p>SLACK_OPS_CRITICAL_WEBHOOK_URL defined: {String(envDiagnostic.opsCriticalConfigured)}</p>
        </div>
      )}

      <form action={formAction} className="flex items-center gap-3">
        <button
          type="submit"
          name="channel"
          value="ops-alerts"
          disabled={pending}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold rounded-lg text-sm whitespace-nowrap"
        >
          {pending ? "Sending…" : "Send ops-alerts test"}
        </button>
        <button
          type="submit"
          name="channel"
          value="ops-critical"
          disabled={pending}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold rounded-lg text-sm whitespace-nowrap"
        >
          {pending ? "Sending…" : "Send ops-critical test"}
        </button>
      </form>

      {state.error && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}

      {state.result === "delivered" && (
        <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          ✓ Test message sent to #{state.channel}.
        </p>
      )}

      {state.result === "no-webhook" && state.channel && (
        <p className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No webhook configured for #{state.channel}. Set{" "}
          <code className="font-mono text-xs bg-amber-100 px-1 rounded">
            {ENV_VAR[state.channel]}
          </code>{" "}
          in your environment variables.
        </p>
      )}

      {state.result === "failed" && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          Webhook delivery failed for #{state.channel}. Check server logs for details.
        </p>
      )}
    </div>
  );
}
