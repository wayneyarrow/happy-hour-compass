import Link from "next/link";
import type { VenueCompletion, HealthIndicator } from "@/lib/venueCompletion";

type Props = {
  isPublished: boolean;
  /** True when the venue was created via an approved claim (operator identity verified). */
  isClaimed: boolean;
  completion: VenueCompletion;
  /** ISO timestamp of the last venue row update. */
  updatedAt: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(isoString: string | null): string | null {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

/**
 * Formats the chip label.
 * Boolean indicators:    "Label ✓" or "Label ✕"
 * Count/target:          "Label {count}/{target}" (or "Label ✓" when complete)
 * Count only (events):   "Label {count}"
 */
function chipLabel(indicator: HealthIndicator): string {
  const { label, status, count, target } = indicator;
  if (count !== undefined && target !== undefined) {
    return status === "complete" ? `${label} ✓` : `${label} ${count}/${target}`;
  }
  if (count !== undefined) return `${label} ${count}`;
  return status === "complete" ? `${label} ✓` : `${label} ✕`;
}

// ── Health chip ───────────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<HealthIndicator["status"], string> = {
  complete: "bg-green-50 border-green-200 text-green-700",
  partial:  "bg-amber-50  border-amber-200  text-amber-700",
  missing:  "bg-red-50   border-red-200   text-red-600",
};

function HealthChip({ indicator }: { indicator: HealthIndicator }) {
  const label = chipLabel(indicator);
  const classes = `inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-medium whitespace-nowrap ${STATUS_CLASSES[indicator.status]}`;

  if (indicator.status === "complete") {
    return <span className={classes}>{label}</span>;
  }
  return (
    <Link href={indicator.href} className={`${classes} hover:opacity-75 transition-opacity`}>
      {label}
    </Link>
  );
}

// ── Module ────────────────────────────────────────────────────────────────────

export default function VenueHealthModule({ isPublished, isClaimed, completion, updatedAt }: Props) {
  const { percentage, indicators } = completion;
  const relativeTime = formatRelativeTime(updatedAt);

  const percentageColor =
    percentage >= 80 ? "text-green-700" : percentage >= 50 ? "text-amber-700" : "text-red-600";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
          <svg
            className="w-4 h-4 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900">Venue Health</h3>
      </div>

      {/* Summary row */}
      <div className="flex items-center gap-2.5 flex-wrap mb-4 pb-4 border-b border-gray-100 text-xs">
        {/* Publish status */}
        {isPublished ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-green-700">
            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" aria-hidden="true" />
            Live
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-semibold text-gray-500">
            <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" aria-hidden="true" />
            Unpublished
          </span>
        )}

        <span className="text-gray-200" aria-hidden="true">·</span>

        {/* Verification status */}
        {isClaimed ? (
          <span className="font-medium text-green-600">✓ Verified</span>
        ) : (
          <span className="font-medium text-gray-400">Pending</span>
        )}

        <span className="text-gray-200" aria-hidden="true">·</span>

        {/* Completion percentage */}
        <span className={`font-semibold ${percentageColor}`}>{percentage}% ready</span>

        {/* Updated at */}
        {relativeTime && (
          <>
            <span className="text-gray-200" aria-hidden="true">·</span>
            <span className="text-gray-400">Updated {relativeTime}</span>
          </>
        )}
      </div>

      {/* Health chips */}
      <div className="flex flex-wrap gap-2">
        {indicators.map((indicator) => (
          <HealthChip key={indicator.key} indicator={indicator} />
        ))}
      </div>
    </div>
  );
}
