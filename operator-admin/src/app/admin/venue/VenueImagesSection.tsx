"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { imagesNudge } from "@/lib/planNudges";
import type { OperatorPlan } from "@/lib/plans";
import { createClient } from "@/lib/supabase/browser";
import {
  processImageFile,
  ImageTooLargeError,
  InvalidImageTypeError,
} from "@/lib/imageProcessing";
import {
  uploadVenueImageAction,
  deleteVenueImageAction,
  reorderVenueImagesAction,
} from "./imageActions";

// ── Types ─────────────────────────────────────────────────────────────────────

type MediaRow = {
  id: string;
  url: string;
  sort_order: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps establishment type to the same placeholder image path used on the
 * consumer detail page. Mirrors getVenueImageSrc() in venue/[id]/page.tsx.
 */
function getPlaceholderImageSrc(establishmentType: string): string {
  const t = establishmentType.toLowerCase();
  if (t.includes("fine dining") || t.includes("upscale")) return "/images/fine-dining-1.jpg";
  if (t.includes("sports bar")) return "/images/sports-bar-1.jpg";
  if (t.includes("brewery")) return "/images/casual-dining-1.jpg";
  if (t.includes("pub")) return "/images/sports-bar-1.jpg";
  if (t.includes("casual")) return "/images/casual-dining-2.jpg";
  return "/images/casual-dining-1.jpg";
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  venueId: string | null | undefined;
  /** Used to show the correct placeholder preview when no images are uploaded. */
  establishmentType?: string | null;
  /** Maximum number of images allowed on this operator's plan. */
  imageLimit: number;
  /** Current operator plan — used for plan-aware upgrade nudges. */
  plan: OperatorPlan;
  /** Whether the current user is the account owner (controls CTA wording). */
  isOwner: boolean;
};

export default function VenueImagesSection({ venueId, establishmentType, imageLimit, plan, isOwner }: Props) {
  const [images, setImages] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch (browser client — "media: authenticated read" permits all authed users) ──

  const refreshImages = async () => {
    if (!venueId) return;
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("media")
      .select("id, url, sort_order")
      .eq("venue_id", venueId)
      .eq("type", "venue_image")
      .order("sort_order", { ascending: true });

    if (fetchError) {
      console.error("[VenueImagesSection] Fetch failed:", fetchError);
      return;
    }
    setImages((data as MediaRow[]) ?? []);
  };

  useEffect(() => {
    if (!venueId) return;
    setLoading(true);
    refreshImages().finally(() => setLoading(false));
    // venueId is stable (venue.id never changes while on the page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId]);

  // ── Upload ─────────────────────────────────────────────────────────────────

  const handleUpload = async (files: FileList | null) => {
    if (!files || !venueId) return;
    setError(null);

    const slots = imageLimit - images.length;
    if (slots <= 0) return;

    setUploading(true);
    const toUpload = Array.from(files).slice(0, slots);

    for (const file of toUpload) {
      // Process (resize + compress) in the browser before sending to the server.
      let blob: Blob;
      try {
        blob = await processImageFile(file, {
          maxWidth: 1600,
          maxSizeBytes: 1.5 * 1024 * 1024,
        });
      } catch (err) {
        if (err instanceof InvalidImageTypeError) {
          setError("Please upload a valid image file.");
        } else if (err instanceof ImageTooLargeError) {
          setError(
            "This image is too large even after compression. Please choose a smaller image."
          );
        } else {
          setError("Failed to process image. Please try again.");
        }
        setUploading(false);
        return;
      }

      const formData = new FormData();
      formData.append("file", new File([blob], `${crypto.randomUUID()}.jpg`, { type: "image/jpeg" }));

      const { error: actionError } = await uploadVenueImageAction(venueId, formData);

      if (actionError) {
        setError(actionError);
        setUploading(false);
        return;
      }
    }

    await refreshImages();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Re-order ───────────────────────────────────────────────────────────────

  const reorderImages = async (newOrder: MediaRow[]) => {
    if (!venueId) return;
    const { error: actionError } = await reorderVenueImagesAction(
      venueId,
      newOrder.map((img) => img.id)
    );
    if (actionError) {
      setError(actionError);
      return;
    }
    await refreshImages();
  };

  const handleSetPrimary = (id: string) => {
    const target = images.find((img) => img.id === id);
    if (!target) return;
    const rest = images.filter((img) => img.id !== id);
    reorderImages([target, ...rest]);
  };

  const handleMoveLeft = (index: number) => {
    if (index === 0) return;
    const next = [...images];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    reorderImages(next);
  };

  const handleMoveRight = (index: number) => {
    if (index === images.length - 1) return;
    const next = [...images];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    reorderImages(next);
  };

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async (img: MediaRow) => {
    if (!venueId) return;
    setError(null);

    const { error: actionError } = await deleteVenueImageAction(venueId, img.id, img.url);

    if (actionError) {
      setError(actionError);
      return;
    }

    // Re-normalise sort_order on the remaining images to keep them 0..n-1.
    const remaining = images.filter((i) => i.id !== img.id);
    await reorderImages(remaining);
  };

  // ── Guard: venue not yet saved ─────────────────────────────────────────────

  if (!venueId) {
    return (
      <p className="text-sm text-gray-500">
        Save this venue before adding images.
      </p>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const atMax = images.length >= imageLimit;

  return (
    <div className="space-y-4">

      {/* Error banner */}
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Upload control */}
      <div className="flex items-center gap-3">
        <label
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
            atMax || uploading
              ? "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed"
              : "border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 cursor-pointer"
          }`}
        >
          <svg
            className="w-4 h-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12V4m0 0L8 8m4-4l4 4"
            />
          </svg>
          {uploading ? "Uploading…" : "Upload images"}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={atMax || uploading}
            onChange={(e) => handleUpload(e.target.files)}
          />
        </label>
        <span className={`text-xs tabular-nums ${atMax ? "font-semibold text-amber-700" : "text-gray-400"}`}>
          {atMax
            ? `${images.length} / ${imageLimit} — limit reached`
            : `${images.length} / ${imageLimit} images uploaded`}
        </span>
      </div>

      {/* At-limit nudge */}
      {atMax && (() => {
        const { atLimitMsg, upgradeSuggestion } = imagesNudge(plan);
        return (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-800">
            {atLimitMsg}
            {upgradeSuggestion && <> {upgradeSuggestion}</>}
            {upgradeSuggestion && (
              <>
                {" "}
                {isOwner ? (
                  <Link
                    href="/admin/subscription"
                    className="font-semibold underline underline-offset-2 hover:text-amber-900 transition-colors"
                  >
                    Change your plan →
                  </Link>
                ) : (
                  <span className="text-amber-700">Ask the account owner to change the plan.</span>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* Thumbnail grid */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading images…</p>
      ) : images.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-4 items-start">
          {/* Placeholder preview */}
          <div className="w-20 h-16 rounded-lg overflow-hidden flex-shrink-0 border border-amber-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getPlaceholderImageSrc(establishmentType ?? "")}
              alt="Current placeholder"
              className="w-full h-full object-cover opacity-75"
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-amber-800 mb-0.5">
              No venue photos uploaded yet
            </p>
            <p className="text-xs text-amber-700 leading-relaxed">
              Your public listing currently shows a generic placeholder image
              based on your venue type. Upload real venue photos above to
              replace it.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {images.map((img, i) => (
            <div
              key={img.id}
              className="rounded-xl overflow-hidden border border-gray-200 bg-white"
            >
              {/* Thumbnail */}
              <div className="relative aspect-[4/3] bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={`Venue image ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                {i === 0 && (
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 text-xs font-bold bg-amber-500 text-white px-2.5 py-1 rounded-full shadow-md">
                    <svg className="w-3 h-3 fill-current flex-shrink-0" viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    Primary
                  </span>
                )}
              </div>

              {/* Controls */}
              <div className="px-2 py-2 flex items-center gap-1">
                {i > 0 ? (
                  <button
                    type="button"
                    onClick={() => handleSetPrimary(img.id)}
                    className="text-xs text-amber-700 hover:text-amber-800 font-medium mr-auto"
                  >
                    Set primary
                  </button>
                ) : (
                  <span className="mr-auto" />
                )}
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => handleMoveLeft(i)}
                    disabled={i === 0}
                    aria-label="Move left"
                    className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed text-xs"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveRight(i)}
                    disabled={i === images.length - 1}
                    aria-label="Move right"
                    className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed text-xs"
                  >
                    →
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(img)}
                    aria-label="Delete image"
                    className="w-6 h-6 flex items-center justify-center rounded border border-red-200 text-red-500 hover:bg-red-50 text-xs"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
