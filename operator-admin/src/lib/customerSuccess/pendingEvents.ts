/**
 * Read-only retrieval of Customer Success events ready for communication.
 *
 * This is the interface Phase 1B is expected to call from its own send
 * step/scheduler. It only reads customer_success_events — it does not send
 * anything, does not compose email content, and does not decide *how* to
 * communicate. Phase 1A stops at "here are the pending rows."
 */

import { createAdminClient } from "@/lib/supabase/server";
import { fetchAllRows } from "./pagination";
import type { CustomerSuccessEventType } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

export type PendingCustomerSuccessEvent = {
  id: string;
  venueId: string;
  operatorId: string | null;
  eventType: CustomerSuccessEventType;
  milestoneValue: number | null;
  metricValueAtDetection: number | null;
  achievedAt: string;
};

/**
 * Every customer_success_events row with communication_status = 'pending',
 * oldest-achieved first. Paginated (see pagination.ts) so this stays
 * correct regardless of backlog size.
 *
 * Phase 1B: this is the read side only. Marking a row 'sent'/'skipped'/
 * 'failed' and populating sent_at/recipient_email/provider_message_id is
 * Phase 1B's responsibility once it actually sends something.
 */
export async function getPendingCustomerSuccessEvents(
  admin: AdminClient = createAdminClient()
): Promise<PendingCustomerSuccessEvent[]> {
  const rows = await fetchAllRows<{
    id: string;
    venue_id: string;
    operator_id: string | null;
    event_type: CustomerSuccessEventType;
    milestone_value: number | null;
    metric_value_at_detection: number | null;
    achieved_at: string;
  }>((from, to) =>
    admin
      .from("customer_success_events")
      .select("id, venue_id, operator_id, event_type, milestone_value, metric_value_at_detection, achieved_at")
      .eq("communication_status", "pending")
      .order("achieved_at", { ascending: true })
      .range(from, to)
  );

  return rows.map((r) => ({
    id: r.id,
    venueId: r.venue_id,
    operatorId: r.operator_id,
    eventType: r.event_type,
    milestoneValue: r.milestone_value,
    metricValueAtDetection: r.metric_value_at_detection,
    achievedAt: r.achieved_at,
  }));
}
