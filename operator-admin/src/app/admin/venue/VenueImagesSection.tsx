"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/browser";
import {
  processImageFile,
  ImageTooLargeError,
  InvalidImageTypeError,
} from "@/lib/imageProcessing";

// ── Types ─────────────────────────────────────────────────────────────────────

type MediaRow = {
  id: string;
  url: string;
  sort_order: number;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const BUCKET = "venue-images";
const MAX_IMAGES = 5;

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  venueId: string | null | undefined;
};

export default function VenueImagesSection({ venueId }: Props) {
  const [images, setImages] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────

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

    const slots = MAX_IMAGES - images.length;
    if (slots <= 0) return;

    setUploading(true);
    const supabase = createClient();
    const toUpload = Array.from(files).slice(0, slots);

    for (const file of toUpload) {
      // ── Process (resize + compress) before upload ─────────────────────────
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

      // Always store as .jpg (output is always JPEG after processing).
      const path = `venues/${venueId}/${crypto.randomUUID()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { cacheControl: "3600", upsert: false, contentType: "image/jpeg" });

      if (uploadError) {
        setError(`Upload failed: ${uploadError.message}`);
        setUploading(false);
        return;
      }

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      // Re-query the live count so back-to-back uploads get sequential sort_orders.
      const { data: existing } = await supabase
        .from("media")
        .select("id")
        .eq("venue_id", venueId)
        .eq("type", "venue_image");
      const sortOrder = existing?.length ?? 0;

      const { error: insertError } = await supabase.from("media").insert({
        venue_id: venueId,
        url: publicUrl,
        sort_order: sortOrder,
        type: "venue_image",
      });

      if (insertError) {
        setError(`Failed to save image record: ${insertError.message}`);
        setUploading(false);
        return;
      }
    }

    await refreshImages();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Re-order ───────────────────────────────────────────────────────────────

  /**
   * Persists a new image order by writing each item's new index as sort_order.
   * Called by all three ordering controls (set primary, move left, move right).
   */
  const reorderImages = async (newOrder: MediaRow[]) => {
    const supabase = createClient();
    await Promise.all(
      newOrder.map((img, i) =>
        supabase.from("media").update({ sort_order: i }).eq("id", img.id)
      )
    );
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
    setError(null);
    const supabase = createClient();

    const { error: deleteError } = await supabase
      .from("media")
      .delete()
      .eq("id", img.id);

    if (deleteError) {
      setError(`Failed to delete image: ${deleteError.message}`);
      return;
    }

    // Best-effort: also delete the file from storage.
    // Public URL path: /storage/v1/object/public/<bucket>/<storagePath>
    try {
      const urlObj = new URL(img.url);
      const match = urlObj.pathname.match(/\/public\/[^/]+\/(.+)$/);
      if (match?.[1]) {
        await supabase.storage.from(BUCKET).remove([match[1]]);
      }
    } catch {
      // Non-fatal — the media row is already gone.
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

  const atMax = images.length >= MAX_IMAGES;

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
        <span className="text-xs text-gray-400">
          {atMax
            ? "Maximum of 5 images reached."
            : `${images.length} / ${MAX_IMAGES} images uploaded`}
        </span>
      </div>

      {/* Thumbnail grid */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading images…</p>
      ) : images.length === 0 ? (
        <p className="text-sm text-gray-400">
          No images yet. Upload your first image above.
        </p>
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
                  <span className="absolute top-2 left-2 text-xs font-semibold bg-amber-500 text-white px-2 py-0.5 rounded-full">
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
