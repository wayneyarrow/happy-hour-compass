"use client";

import { useState, useEffect } from "react";

type VenueImage = { url: string };

type Props = {
  images: VenueImage[];
  venueName: string;
};

// ─── All-photos overlay ───────────────────────────────────────────────────────

function AllPhotosOverlay({
  images,
  venueName,
  onClose,
}: {
  images: VenueImage[];
  venueName: string;
  onClose: () => void;
}) {
  // Close on ESC key.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`All photos of ${venueName}`}
    >
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-white font-semibold text-lg">{venueName}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close photos"
            className="flex items-center gap-2 text-white/70 hover:text-white transition-colors text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-md px-1"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
            Close
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {images.map((img, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={img.url}
              alt={i === 0 ? venueName : ""}
              loading="lazy"
              className="w-full aspect-square object-cover rounded-xl"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Desktop gallery (Airbnb-style grid) ─────────────────────────────────────

function DesktopGallery({
  images,
  venueName,
  onShowAll,
}: {
  images: VenueImage[];
  venueName: string;
  onShowAll: () => void;
}) {
  const rightImages = images.slice(1, 5); // up to 4 supporting images
  const showAllBtn = images.length > 5;
  const hasRight = rightImages.length > 0;
  const rightIsGrid = rightImages.length >= 3; // 3-4 images → 2×2 grid on right

  return (
    <div
      className={`hidden md:grid gap-2 h-[420px] lg:h-[480px] rounded-2xl overflow-hidden ${
        hasRight ? "grid-cols-[3fr_2fr]" : ""
      }`}
    >
      {/* Primary image */}
      <div className="relative overflow-hidden group">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[0].url}
          alt={venueName}
          loading="eager"
          fetchPriority="high"
          className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.backgroundColor = "#f3f4f6";
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        {/* "Show all photos" on primary when there's no right grid (≤1 total image) */}
        {images.length > 1 && !hasRight && (
          <button
            type="button"
            onClick={onShowAll}
            className="absolute bottom-4 right-4 flex items-center gap-2 px-4 py-2.5 bg-white/90 backdrop-blur-sm rounded-xl text-sm font-semibold text-gray-900 hover:bg-white transition-colors shadow-sm border border-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            Show all {images.length} photos
          </button>
        )}
      </div>

      {/* Right column */}
      {hasRight && (
        <div
          className={`grid gap-2 ${
            rightIsGrid ? "grid-cols-2 grid-rows-2" : "grid-cols-1"
          }`}
        >
          {rightImages.map((img, i) => (
            <div key={i} className="relative overflow-hidden group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.backgroundColor = "#f3f4f6";
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
              {/* "Show all photos" button over the last visible right image */}
              {showAllBtn && i === rightImages.length - 1 && (
                <button
                  type="button"
                  onClick={onShowAll}
                  className="absolute inset-0 flex items-end justify-end p-3 bg-black/20 hover:bg-black/30 transition-colors focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-amber-400"
                  aria-label={`Show all ${images.length} photos`}
                >
                  <span className="flex items-center gap-1.5 px-3 py-2 bg-white/90 backdrop-blur-sm rounded-lg text-xs font-semibold text-gray-900 shadow-sm">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    Show all {images.length} photos
                  </span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Mobile gallery (hero + thumbnail strip) ──────────────────────────────────

function MobileGallery({
  images,
  venueName,
  onShowAll,
}: {
  images: VenueImage[];
  venueName: string;
  onShowAll: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <div className="md:hidden">
      {/* Hero */}
      <div className="relative h-[280px] bg-gray-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[activeIndex]?.url ?? ""}
          alt={venueName}
          loading="eager"
          fetchPriority="high"
          className="w-full h-full object-cover object-center"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        {/* Photo count pill */}
        {images.length > 1 && (
          <button
            type="button"
            onClick={onShowAll}
            aria-label={`View all ${images.length} photos`}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 bg-black/50 backdrop-blur-sm rounded-lg text-xs font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            {activeIndex + 1} / {images.length}
          </button>
        )}
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="flex gap-2 px-4 py-2.5 overflow-x-auto scrollbar-hide bg-white border-b border-gray-100">
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIndex(i)}
              aria-label={`View image ${i + 1}`}
              className="shrink-0 rounded-md overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              style={{
                width: 56,
                height: 42,
                border:
                  i === activeIndex
                    ? "2px solid #f59e0b"
                    : "2px solid transparent",
                opacity: i === activeIndex ? 1 : 0.6,
                transition: "border-color 0.15s, opacity 0.15s",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover object-center"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── VenueGallery ─────────────────────────────────────────────────────────────

export function VenueGallery({ images, venueName }: Props) {
  const [showAll, setShowAll] = useState(false);

  // Prevent page scroll while the all-photos overlay is open.
  useEffect(() => {
    document.body.style.overflow = showAll ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showAll]);

  if (images.length === 0) return null;

  return (
    <>
      {showAll && (
        <AllPhotosOverlay
          images={images}
          venueName={venueName}
          onClose={() => setShowAll(false)}
        />
      )}

      {/* Mobile gallery */}
      <MobileGallery
        images={images}
        venueName={venueName}
        onShowAll={() => setShowAll(true)}
      />

      {/* Desktop gallery — inside max-width container margin */}
      <div className="max-w-7xl mx-auto px-6 lg:px-10 pt-6">
        <DesktopGallery
          images={images}
          venueName={venueName}
          onShowAll={() => setShowAll(true)}
        />
      </div>
    </>
  );
}
