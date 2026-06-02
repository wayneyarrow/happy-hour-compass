"use client";

import Link from "next/link";

type Props = {
  title: string;
  subtitle?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  children: React.ReactNode;
};

export function RailSection({
  title,
  subtitle,
  viewAllHref,
  viewAllLabel = "See all",
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
              fontSize: 17,
              fontWeight: 700,
              color: "#111827",
              lineHeight: 1.2,
              margin: 0,
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
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "#3b82f6",
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
          gap: 10,
          overflowX: "auto",
          padding: "2px 20px 6px",
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
