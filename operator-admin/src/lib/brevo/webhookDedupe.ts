import { createHash } from "node:crypto";

/**
 * Deterministically hashes a canonicalized (sorted-keys) JSON payload for
 * webhook dedupe. See supabase/migrations/076_brevo_webhook_events.sql for
 * why this — rather than trusting a specific Brevo payload field to be a
 * reliable per-event-instance ID — is the dedupe strategy: a genuine
 * redelivery of the same event hashes identically regardless of which
 * field names the real (not-yet-configured) Brevo webhook turns out to
 * send.
 */
export function hashWebhookPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
  return `{${entries.join(",")}}`;
}
