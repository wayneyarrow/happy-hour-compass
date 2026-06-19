"use client";

import Link from "next/link";

type Props = {
  title: string;
  subtitle?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  onViewAll?: () => void;
  children: React.ReactNode;
};

export function RailSection({
  title,
  subtitle,
  viewAllHref,
  viewAllLabel = "See all",
  onViewAll,
  children,
}: Props) {
  return (
    <section style={{ marginBottom: 28 }}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          padding: "0 20px",
          marginBottom: 10,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 19,
              fontWeight: 800,
              color: "#111827",
              lineHeight: 1.2,
              margin: 0,
              letterSpacing: "-0.2px",
            }}
          >
            {title}
          </h2>
          {subtitle && (
            <p
              style={{
                fontSize: 12,
                color: "#9ca3af",
                marginTop: 2,
                marginBottom: 0,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            onClick={onViewAll}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#d97706",
              whiteSpace: "nowrap",
              flexShrink: 0,
              marginLeft: 12,
              textDecoration: "none",
            }}
          >
            {viewAllLabel} →
          </Link>
        )}
      </div>

      {/* Horizontal scroll track — hides scrollbar via global .hhc-rail rule */}
      <div
        className="hhc-rail"
        style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          padding: "4px 20px 12px",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {children}
      </div>
    </section>
  );
}
