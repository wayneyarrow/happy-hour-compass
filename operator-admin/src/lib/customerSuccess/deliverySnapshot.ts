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

export type DeliverySnapshot = {
  recipientFirstName: string;
  venueName: string;
  /**
   * Template locked at the first provider attempt (setup-contact
   * coordination). Absent on snapshots written before it existed — those
   * were always the standard template.
   */
  variant?: "standard" | "incomplete_setup";
};

export function parseDeliverySnapshot(metadataJson: unknown): DeliverySnapshot | null {
  if (!metadataJson || typeof metadataJson !== "object") return null;
  const snap = (metadataJson as Record<string, unknown>).deliverySnapshot;
  if (!snap || typeof snap !== "object") return null;
  const s = snap as Record<string, unknown>;
  if (typeof s.recipientFirstName !== "string" || typeof s.venueName !== "string") return null;
  const variant = s.variant === "incomplete_setup" ? "incomplete_setup" : s.variant === "standard" ? "standard" : undefined;
  return { recipientFirstName: s.recipientFirstName, venueName: s.venueName, ...(variant ? { variant } : {}) };
}

/**
 * Latest setup-contact spacing deferral recorded on a milestone event
 * (metadata_json.coordination.lastDeferral). A deferral is never a delivery
 * attempt: attempt_count and communication_status are untouched by it.
 */
export type MilestoneDeferral = {
  deferredAt: string;
  deferredUntil: string;
  reason: "recent_setup_contact" | "recent_setup_pause" | "recent_milestone";
  contactAt: string;
  contactKind: string | null;
};

export function parseMilestoneDeferral(metadataJson: unknown): MilestoneDeferral | null {
  if (!metadataJson || typeof metadataJson !== "object") return null;
  const coordination = (metadataJson as Record<string, unknown>).coordination;
  if (!coordination || typeof coordination !== "object") return null;
  const d = (coordination as Record<string, unknown>).lastDeferral;
  if (!d || typeof d !== "object") return null;
  const x = d as Record<string, unknown>;
  const reasons = ["recent_setup_contact", "recent_setup_pause", "recent_milestone"] as const;
  if (typeof x.deferredAt !== "string" || typeof x.deferredUntil !== "string" || typeof x.contactAt !== "string") return null;
  if (!(reasons as readonly string[]).includes(x.reason as string)) return null;
  return {
    deferredAt: x.deferredAt,
    deferredUntil: x.deferredUntil,
    reason: x.reason as MilestoneDeferral["reason"],
    contactAt: x.contactAt,
    contactKind: typeof x.contactKind === "string" ? x.contactKind : null,
  };
}
