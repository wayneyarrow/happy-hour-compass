import { getDefaultBrevoAdminClient, type BrevoAdminClient } from "./supabaseAdminClient";

/**
 * Generic entity-agnostic Brevo contact-sync enqueue. `consumer` is the only
 * entity type Phase 1 activates end-to-end, but nothing in this file's
 * persistence layer assumes "consumer" — `operator` is a first-class value
 * today so a future phase can start enqueuing operator syncs without
 * touching this module or the outbox schema.
 */
export type BrevoEntityType = "consumer" | "operator";

export type BrevoContactDesiredState = {
  entityType: BrevoEntityType;
  /**
   * HHC/Supabase UUID for this entity (consumer_profiles.id / operators.id).
   * A future processor phase maps this to Brevo's EXT_ID attribute — it is
   * never the upsert key itself (Brevo's native email identifier is used
   * for that, per the approved contact model).
   */
  entityId: string;
  email: string;
  /** Only pre-existing Brevo attributes (FIRSTNAME/LASTNAME) — do not add new custom attribute keys here without confirming they already exist in Brevo. */
  attributes?: Partial<{ FIRSTNAME: string; LASTNAME: string }>;
  /** Target list. Callers must always source this from config (e.g. getBrevoConfig().consumerListId) — never a literal 2 or 3. */
  listId: number;
  /**
   * Desired marketing eligibility. Captured now for forward-compatibility;
   * Phase 1's outbox processor only performs the contact upsert itself —
   * acting on `subscribed` (e.g. explicit list add/remove beyond the
   * initial upsert, or unsubscribe application) is Phase 2 scope.
   */
  subscribed: boolean;
};

export type EnqueueBrevoContactSyncResult =
  | { ok: true; outboxId: string; status: string }
  | { ok: false; error: string };

/** Deterministic per (entityType, entityId, operation) — the outbox's dedupe key. */
export function buildDedupeKey(entityType: BrevoEntityType, entityId: string, operation: string): string {
  return `${entityType}:${operation}:${entityId}`;
}

/**
 * Enqueues (or coalesces into an already in-flight job for the same entity)
 * a Brevo contact-sync desired state via the enqueue_brevo_contact_sync
 * Postgres function (supabase/migrations/075_brevo_sync_outbox.sql), which
 * performs the atomic insert-or-coalesce.
 *
 * NOT called from any live signup/account/confirmation flow in Phase 1 —
 * see the Brevo integration foundation report for the exact Phase 1
 * boundary. This function exists so Phase 2 has a single, already-tested
 * entry point to wire up rather than writing to the outbox table directly.
 */
export async function enqueueBrevoContactSync(
  desired: BrevoContactDesiredState,
  supabase: BrevoAdminClient = getDefaultBrevoAdminClient()
): Promise<EnqueueBrevoContactSyncResult> {
  const operation = "upsert_contact";
  const dedupeKey = buildDedupeKey(desired.entityType, desired.entityId, operation);

  const payload = {
    email: desired.email,
    attributes: desired.attributes ?? {},
    listId: desired.listId,
    subscribed: desired.subscribed,
  };

  const { data, error } = await supabase.rpc("enqueue_brevo_contact_sync", {
    p_entity_type: desired.entityType,
    p_entity_id: desired.entityId,
    p_operation: operation,
    p_dedupe_key: dedupeKey,
    p_payload: payload,
  });

  if (error || !data) {
    console.error("[brevo/contactSync] enqueue failed:", error?.message ?? "no row returned");
    return { ok: false, error: error?.message ?? "Unknown enqueue error" };
  }

  const row = data as { id: string; status: string };
  return { ok: true, outboxId: row.id, status: row.status };
}
