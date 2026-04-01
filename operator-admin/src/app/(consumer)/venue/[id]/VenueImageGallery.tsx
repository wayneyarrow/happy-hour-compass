"use client";

import { useState } from "react";

type VenueImage = { url: string };

type Props = {
  images: VenueImage[];
  venueName: string;
};

/**
 * Hero image + optional thumbnail strip for the venue detail page.
 *
 * - Single image: renders hero only, no strip.
 * - Multiple images: renders hero + horizontally scrollable thumbnail strip below.
 * - Tapping a thumbnail updates the hero.
 * - Structured to render from a single `images` prop so future plan-based
 *   gating can be applied by slicing the array before passing it in.
 */
export function VenueImageGallery({ images, venueName }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);

  const activeImage = images[activeIndex]?.url ?? null;

  return (
    <>
      {/* Hero image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={activeImage ?? ""}
        alt={venueName}
        className="w-full object-cover object-center"
        style={{ height: 240, backgroundColor: "#e5e7eb" }}
      />

      {/* Thumbnail strip — only when more than one image */}
      {images.length > 1 && (
        <div className="flex gap-2 px-5 py-3 overflow-x-auto scrollbar-hide">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => setActiveIndex(i)}
              className="shrink-0 rounded-md overflow-hidden focus:outline-none"
              style={{
                width: 64,
                height: 48,
                border: i === activeIndex ? "2px solid #f97316" : "2px solid transparent",
                opacity: i === activeIndex ? 1 : 0.65,
                transition: "border-color 0.15s, opacity 0.15s",
              }}
              aria-label={`View image ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                className="w-full h-full object-cover object-center"
              />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
