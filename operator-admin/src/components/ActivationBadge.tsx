import { ACTIVATION_STATE_LABELS, type ActivationLifecycleState } from "@/lib/activation/activationState";

/**
 * Shared activation-state badge for the Founder Control Panel's Claims and
 * Submissions screens (Phase 1B) — a SEPARATE visual dimension from each
 * flow's own approval/routing-status badge (StatusBadge in ClaimsTable.tsx /
 * MATCH_STATUS_CONFIG in SubmissionsTable.tsx), never a replacement for it.
 * Follows the same local Record<state,{label,classes}> + inline <span>
 * convention already used by every other status badge in this codebase
 * (no shared generic StatusBadge component is used by Claims/Submissions
 * today) so this visually matches its neighbors.
 */

const CLASSES: Record<ActivationLifecycleState, string> = {
  not_tracked: "bg-gray-100 text-gray-500",
  awaiting_setup: "bg-blue-100 text-blue-700",
  expiring_soon: "bg-amber-100 text-amber-700",
  release_required: "bg-red-100 text-red-700",
  active: "bg-green-100 text-green-700",
  expired: "bg-slate-200 text-slate-700",
  released: "bg-slate-100 text-slate-600",
  setup_delivery_error: "bg-red-100 text-red-700",
};

export default function ActivationBadge({ state }: { state: ActivationLifecycleState }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${CLASSES[state]}`}>
      {ACTIVATION_STATE_LABELS[state]}
    </span>
  );
}
