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

function healthContext(percentage: number): string {
  if (percentage >= 80) return "Your listing is in strong shape.";
  if (percentage >= 60) return "A few updates could make your listing stand out more.";
  return "There's room to grow — guests see what you show them.";
}

// ── Strength meter ────────────────────────────────────────────────────────────
// 8-segment visual bar provides instant momentum reading of the percentage score.
// Colour matches the existing green / amber / red thresholds.

function StrengthMeter({ percentage }: { percentage: number }) {
  const segments = 8;
  const filled = Math.round((percentage / 100) * segments);
  const filledColor =
    percentage >= 80 ? "bg-green-400" : percentage >= 60 ? "bg-amber-400" : "bg-red-400";

  return (
    <div className="flex gap-1.5" role="presentation" aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full ${i < filled ? filledColor : "bg-gray-100"}`}
        />
      ))}
    </div>
  );
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
    percentage >= 80 ? "text-green-700" : percentage >= 60 ? "text-amber-600" : "text-red-600";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      {/* ── Strength section ── title + meter + context, separated from details below */}
      <div className="mb-4 pb-4 border-b border-gray-100">
        {/* Title row with prominent percentage */}
        <div className="flex items-center gap-3 mb-2.5">
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
          <h3 className="text-sm font-semibold text-gray-900 flex-1">Listing Strength</h3>
          <span
            className={`text-lg font-bold tabular-nums ${percentageColor}`}
            aria-label={`${percentage}% complete`}
          >
            {percentage}%
          </span>
        </div>

        {/* Segmented strength meter — instant visual read of the score */}
        <StrengthMeter percentage={percentage} />

        {/* Contextual one-liner */}
        <p className="text-xs text-gray-500 mt-2 leading-relaxed">
          {healthContext(percentage)}
        </p>
      </div>

      {/* ── Status row ── Live / Verified / Updated at */}
      <div className="flex items-center gap-2.5 flex-wrap mb-4 text-xs">
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

        {isClaimed ? (
          <span className="font-medium text-green-600">✓ Verified</span>
        ) : (
          <span className="font-medium text-gray-400">Unverified</span>
        )}

        {relativeTime && (
          <>
            <span className="text-gray-200" aria-hidden="true">·</span>
            <span className="text-gray-400">Updated {relativeTime}</span>
          </>
        )}
      </div>

      {/* ── Health chips ── each incomplete chip links directly to the relevant section */}
      <div className="flex flex-wrap gap-2">
        {indicators.map((indicator) => (
          <HealthChip key={indicator.key} indicator={indicator} />
        ))}
      </div>
    </div>
  );
}
