import { getActivationEventLabel } from "@/lib/activation/activationEvents";
import { formatDateTime } from "@/lib/controlPanelDateTime";

/**
 * Renders a structured Internal Note's event_type as a friendly pill, plus a
 * SELECTIVE, allowlisted subset of its metadata_json — never the raw JSON
 * blob. Shared by ClaimNotesSection and InternalNotesSection (Phase 1B) so
 * both flows render identical structured-note presentation.
 *
 * Only keys in DATE_METADATA_KEYS / TEXT_METADATA_KEYS below are ever shown.
 * This is a deliberate allowlist, not a denylist — a future event type that
 * adds a new metadata field is invisible here until explicitly added to one
 * of these lists, which is the safe default for "never secret-shaped."
 */

const DATE_METADATA_KEYS: Record<string, string> = {
  activationDeadline: "Deadline",
  previousDeadline: "Previous deadline",
  newDeadline: "New deadline",
  currentDeadline: "Deadline",
  previousExpiredAt: "Previously expired",
};

const TEXT_METADATA_KEYS: Record<string, string> = {
  recipient: "Sent to",
  extensionDays: "Extension",
  extendedByEmail: "Extended by",
};

export default function ActivationNoteMeta({
  eventType,
  metadata,
}: {
  eventType: string | null;
  metadata: Record<string, unknown> | null;
}) {
  const label = getActivationEventLabel(eventType);
  if (!label) return null;

  const rows: { label: string; value: string }[] = [];
  if (metadata) {
    for (const [key, displayLabel] of Object.entries(DATE_METADATA_KEYS)) {
      const value = metadata[key];
      if (typeof value === "string" && value) {
        rows.push({ label: displayLabel, value: formatDateTime(value) });
      }
    }
    for (const [key, displayLabel] of Object.entries(TEXT_METADATA_KEYS)) {
      const value = metadata[key];
      if (typeof value === "string" && value) {
        rows.push({ label: displayLabel, value });
      } else if (typeof value === "number") {
        rows.push({ label: displayLabel, value: key === "extensionDays" ? `${value} days` : String(value) });
      }
    }
  }

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600">
        {label}
      </span>
      {rows.map((r) => (
        <span key={r.label} className="text-[11px] text-gray-500">
          {r.label}: <span className="text-gray-700">{r.value}</span>
        </span>
      ))}
    </div>
  );
}
