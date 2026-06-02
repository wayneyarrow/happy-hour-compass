"use client";

import Link from "next/link";
import type { BrowseCategory } from "./browseCategories";
import { BrowseTile } from "./BrowseTile";

type Props = {
  title: string;
  categories: BrowseCategory[];
  seeAllHref: string;
  onNav?: () => void;
};

export function BrowseSection({ title, categories, seeAllHref, onNav }: Props) {
  return (
    <section style={{ marginBottom: 28 }}>
      {/* Header row — mirrors RailSection layout */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          marginBottom: 12,
        }}
      >
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
        <Link
          href={seeAllHref}
          onClick={onNav}
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
          See All →
        </Link>
      </div>

      {/* Horizontal scroll track — same pattern as RailSection */}
      <div
        className="hhc-rail"
        style={{
          display: "flex",
          gap: 16,
          overflowX: "auto",
          padding: "4px 20px 8px",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {categories.map((cat) => (
          <BrowseTile
            key={cat.slug}
            category={cat}
            href={`/home/collections/${cat.slug}`}
            onClick={onNav}
          />
        ))}
      </div>
    </section>
  );
}
