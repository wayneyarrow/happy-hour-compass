/**
 * Delivery snapshot parsing (Correction Pass Section 2 — see
 * processCustomerSuccessDeliveries.ts and migration
 * 095_customer_success_delivery.sql for the full snapshot design).
 *
 * Extracted as a standalone pure helper so a read-only caller that only
 * needs to interpret an already-locked snapshot (e.g. the Founder Control
 * Panel's venue Internal Notes activity — see customerSuccessMilestoneNotes.ts)
 * can do so without importing the full delivery processor module (which
 * pulls in email sending and Slack notification code as a side effect of
 * the import).
 */

export type DeliverySnapshot = { recipientFirstName: string; venueName: string };

export function parseDeliverySnapshot(metadataJson: unknown): DeliverySnapshot | null {
  if (!metadataJson || typeof metadataJson !== "object") return null;
  const snap = (metadataJson as Record<string, unknown>).deliverySnapshot;
  if (!snap || typeof snap !== "object") return null;
  const s = snap as Record<string, unknown>;
  if (typeof s.recipientFirstName !== "string" || typeof s.venueName !== "string") return null;
  return { recipientFirstName: s.recipientFirstName, venueName: s.venueName };
}
