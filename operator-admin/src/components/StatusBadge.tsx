import React from "react";

export type StatusVariant =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral"
  | "premium"
  | "enterprise";

const VARIANT_STYLES: Record<StatusVariant, { badge: string; dot: string }> = {
  success:    { badge: "bg-green-100 text-green-700",   dot: "bg-green-500" },
  warning:    { badge: "bg-amber-100 text-amber-700",   dot: "bg-amber-500" },
  danger:     { badge: "bg-red-100 text-red-700",       dot: "bg-red-500" },
  info:       { badge: "bg-blue-100 text-blue-700",     dot: "bg-blue-500" },
  neutral:    { badge: "bg-gray-100 text-gray-600",     dot: "bg-gray-400" },
  premium:    { badge: "bg-amber-100 text-amber-800",   dot: "bg-amber-600" },
  enterprise: { badge: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
};

type Props = {
  variant: StatusVariant;
  label: string;
  dot?: boolean;
  className?: string;
};

export default function StatusBadge({ variant, label, dot = false, className = "" }: Props) {
  const { badge, dot: dotColor } = VARIANT_STYLES[variant];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${badge} ${className}`}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} aria-hidden="true" />
      )}
      {label}
    </span>
  );
}
