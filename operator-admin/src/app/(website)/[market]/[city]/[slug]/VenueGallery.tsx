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

// ─── Single-photo lightbox ────────────────────────────────────────────────────
//
// Opened by clicking any individual image (primary or secondary) in the
// desktop gallery — starts on the clicked photo and lets the visitor step
// forward/backward through every venue image. Distinct from AllPhotosOverlay
// above (the static "Show all N photos" grid, unchanged) — this is a
// single-photo-at-a-time view, the piece that was previously missing.
// Shares the same overlay chrome conventions (fixed inset-0 z-50 bg-black/95,
// ESC-to-close, role="dialog") as AllPhotosOverlay for visual consistency.

function ImageLightbox({
  images,
  venueName,
  startIndex,
  onClose,
}: {
  images: VenueImage[];
  venueName: string;
  startIndex: number;
  onClose: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(startIndex);
  const hasMultiple = images.length > 1;

  // Close on ESC; step through photos on Left/Right arrows (single-image
  // venues have nothing to step through, so arrows are disabled there).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (hasMultiple && e.key === "ArrowLeft") {
        setActiveIndex((i) => (i - 1 + images.length) % images.length);
      } else if (hasMultiple && e.key === "ArrowRight") {
        setActiveIndex((i) => (i + 1) % images.length);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, hasMultiple, images.length]);

  const current = images[activeIndex];
  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${activeIndex + 1} of ${images.length} — ${venueName}`}
    >
      <div className="flex items-center justify-between px-4 py-4 shrink-0">
        <span className="text-white/70 text-sm font-medium">
          {activeIndex + 1} / {images.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="flex items-center gap-2 text-white/70 hover:text-white transition-colors text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-md px-1"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
          Close
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-4 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={activeIndex === 0 ? venueName : ""}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
        />

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={() => setActiveIndex((i) => (i - 1 + images.length) % images.length)}
              aria-label="Previous photo"
              className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 md:w-6 md:h-6">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setActiveIndex((i) => (i + 1) % images.length)}
              aria-label="Next photo"
              className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 md:w-6 md:h-6">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Desktop gallery (Airbnb-style grid) ─────────────────────────────────────

function DesktopGallery({
  images,
  venueName,
  onShowAll,
  onOpenLightbox,
}: {
  images: VenueImage[];
  venueName: string;
  onShowAll: () => void;
  onOpenLightbox: (index: number) => void;
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
          className="w-full h-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.backgroundColor = "#f3f4f6";
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        {/* Invisible full-cover click target — opens the lightbox on this
            photo. (The previous "Show all photos" button here required
            images.length > 1 AND !hasRight simultaneously, which is
            mutually exclusive — it never actually rendered.) */}
        <button
          type="button"
          onClick={() => onOpenLightbox(0)}
          aria-label={`View photo 1 of ${images.length}`}
          className="absolute inset-0 w-full h-full cursor-pointer focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-amber-400"
        />
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
              {/* Invisible full-cover click target — opens the lightbox on
                  this photo. Previously these secondary images had no
                  interaction at all (the root cause of the desktop bug). */}
              <button
                type="button"
                onClick={() => onOpenLightbox(i + 1)}
                aria-label={`View photo ${i + 2} of ${images.length}`}
                className="absolute inset-0 w-full h-full cursor-pointer focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-amber-400"
              />
              {/* "Show all photos" button over the last visible right image —
                  unchanged; it sits after the click-target button above in
                  DOM order, so it still stacks on top and keeps taking
                  priority on this one thumbnail, exactly as before. */}
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Prevent page scroll while either overlay is open.
  useEffect(() => {
    document.body.style.overflow = showAll || lightboxIndex !== null ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showAll, lightboxIndex]);

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

      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          venueName={venueName}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
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
          onOpenLightbox={(i) => setLightboxIndex(i)}
        />
      </div>
    </>
  );
}
