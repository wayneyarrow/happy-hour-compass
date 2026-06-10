import { createAdminClient } from "@/lib/supabase/server";

interface AuditLogPayload {
  actorEmail: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  details?: Record<string, unknown> | null;
}

/**
 * Appends a row to audit_logs. Fire-and-forget — errors are caught and
 * logged to the console but never surfaced to the caller. Always call
 * after all critical operations succeed so a failure here cannot affect
 * the main action flow.
 */
export async function logAuditEvent(payload: AuditLogPayload): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("audit_logs").insert({
      actor_email:  payload.actorEmail,
      action:       payload.action,
      entity_type:  payload.entityType,
      entity_id:    payload.entityId   ?? null,
      entity_name:  payload.entityName ?? null,
      details_json: payload.details    ?? null,
    });
    if (error) {
      console.error("[logAuditEvent] Insert failed:", error.message, { action: payload.action });
    }
  } catch (err) {
    console.error("[logAuditEvent] Unexpected error:", err);
  }
}
