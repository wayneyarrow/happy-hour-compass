// Boundary fake for "@/lib/slack": records posts instead of calling webhooks.
import { world } from "../world";
export * from "../../../../../src/lib/slack";

export async function sendSlackAlert(p: { channel?: string; title?: string; message?: string }) {
  world.slack.push({ kind: "alert", channel: p.channel, title: p.title, message: p.message });
  return "delivered" as const;
}
export async function sendSlackAcquisitionNotification(p: { channel?: string; text?: string }) {
  world.slack.push({ kind: "acquisition", channel: p.channel, text: p.text });
  return "delivered" as const;
}
