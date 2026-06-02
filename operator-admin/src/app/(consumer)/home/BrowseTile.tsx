"use client";

import Link from "next/link";
import type { BrowseCategory } from "./browseCategories";

type Props = {
  category: BrowseCategory;
  href: string;
  onClick?: () => void;
};

export function BrowseTile({ category, href, onClick }: Props) {
  const hasImage = !!category.imageUrl;

  const circleBg = hasImage
    ? {}
    : { background: category.gradient };

  const imageStyle = hasImage
    ? {
        backgroundImage: `url(${category.imageUrl})`,
        backgroundSize: "cover" as const,
        backgroundPosition: "center" as const,
      }
    : {};

  return (
    <Link
      href={href}
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        textDecoration: "none",
        flexShrink: 0,
        minWidth: 80,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          border: "1.5px solid rgba(0,0,0,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 28,
          flexShrink: 0,
          overflow: "hidden",
          ...circleBg,
          ...imageStyle,
        }}
      >
        {!hasImage && category.emoji}
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "#374151",
          textAlign: "center",
          lineHeight: 1.3,
          maxWidth: 80,
        }}
      >
        {category.label}
      </span>
    </Link>
  );
}
