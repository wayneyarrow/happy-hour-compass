"use client";

import Link from "next/link";
import type { BrowseCategory } from "../../browseCategories";
import { CollectionHeader } from "../../collections/[collection]/CollectionHeader";

// ─── Hub card — substantial visual tile used only on Browse Hub pages ─────────
// Homepage uses circular BrowseTile; hub uses these larger gradient cards.
// When category.imageUrl is set, it becomes the card background (easy future swap).

function BrowseHubCard({ category }: { category: BrowseCategory }) {
  const hasImage = !!category.imageUrl;

  return (
    <Link
      href={`/home/collections/${category.slug}`}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        borderRadius: 14,
        overflow: "hidden",
        height: 148,
        padding: "14px 14px 13px",
        textDecoration: "none",
        WebkitTapHighlightColor: "transparent",
        background: hasImage ? undefined : category.gradient,
        backgroundImage: hasImage ? `url(${category.imageUrl})` : undefined,
        backgroundSize: hasImage ? "cover" : undefined,
        backgroundPosition: hasImage ? "center" : undefined,
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
      }}
    >
      {/* Dark overlay for legibility when using a real image */}
      {hasImage && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.45) 100%)",
            borderRadius: 14,
          }}
        />
      )}

      {/* Emoji — top-left, sits above overlay */}
      <span
        style={{
          fontSize: 36,
          lineHeight: 1,
          position: "relative",
          zIndex: 1,
          filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.2))",
        }}
      >
        {category.emoji}
      </span>

      {/* Label — bottom-left */}
      <span
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: "white",
          letterSpacing: "-0.2px",
          lineHeight: 1.2,
          position: "relative",
          zIndex: 1,
          textShadow: "0 1px 3px rgba(0,0,0,0.35)",
        }}
      >
        {category.label}
      </span>
    </Link>
  );
}

// ─── Browse Hub View ──────────────────────────────────────────────────────────

type Props = {
  title: string;
  categories: BrowseCategory[];
};

export function BrowseHubView({ title, categories }: Props) {
  return (
    <>
      <CollectionHeader title={title} />

      <div style={{ padding: "20px 16px 110px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          {categories.map((cat) => (
            <BrowseHubCard key={cat.slug} category={cat} />
          ))}
        </div>

        {categories.length === 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              padding: "60px 32px",
            }}
          >
            <p style={{ fontSize: 16, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
              Coming soon
            </p>
            <p style={{ fontSize: 14, color: "#9ca3af", margin: 0 }}>
              Categories for this section will appear here.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
